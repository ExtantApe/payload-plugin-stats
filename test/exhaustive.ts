import { present, type Engine, type RawCounts } from '../src/report.js'

/**
 * A reader who knows the code. The hiding rule is public, so a reader can ask of any report: which sites would have
 * produced exactly this page? If every such site agrees that some small group is not 2 people, the page has given
 * that away, even when no arithmetic on the visible numbers would.
 *
 * Nothing here reads how the plugin lays a report out. A shape is described by its users: the kinds of user it tells
 * apart, the counts a site with those users reports, and the groups of users (sets of kinds) that must stay
 * protected. The check builds every possible site of a shape up to a number of users, runs the plugin on each, and
 * groups the sites by the page they publish. For each group that is from 1 to minimum - 1 on some site behind a page,
 * every size from 1 to minimum - 1 the group could have on some site with the same total has to be found among the
 * sites with that page. The total is public, so what the total alone rules out is not a leak.
 */

export interface Secret {
  name: string
  /** Bit k is set when users of kind k are in the group. */
  mask: number
}

export interface Shape {
  name: string
  /** How many kinds of user the shape tells apart. */
  kinds: number
  /** The counts a site reports when it has `people[k]` users of kind k. */
  counts: (people: number[]) => RawCounts
  /** The groups of users a page must not narrow. */
  secrets: Secret[]
}

/** What a site publishes, as one string. */
export type Page = (raw: RawCounts, minimum: number) => string
export const pageWith =
  (engine?: Engine): Page =>
  (raw, minimum) =>
    JSON.stringify(present(raw, minimum, engine))

const none = { new1: 0, new7: 0, new30: 0, fields: [], bands: [] }
const sum = (list: number[]) => list.reduce((s, n) => s + n, 0)
/** Users of the kinds that pass the test. */
const of = (people: number[], test: (kind: number) => boolean) => sum(people.filter((_, k) => test(k)))
/** The group of every kind that passes the test. */
export const group = (name: string, kinds: number, test: (kind: number) => boolean): Secret => ({ name, mask: sum(Array.from({ length: kinds }, (_, k) => (test(k) ? 1 << k : 0))) })
/**
 * One table splits the users into parts (`part` says which part a kind is in). Every group made of some parts, but
 * not all, is a secret: each row, each remainder, and every other group a reader could name from that table.
 */
export function unions(table: string, kinds: number, parts: number, part: (kind: number) => number): Secret[] {
  const out: Secret[] = []
  for (let pick = 1; pick < (1 << parts) - 1; pick++) out.push(group(`${table} parts ${pick.toString(2).padStart(parts, '0')}`, kinds, (k) => (pick & (1 << part(k))) > 0))
  return out
}
/**
 * What a many-value field protects: holders of each value, of each roll-up, of any value and of none, and the users
 * with some value (or some value of a roll-up) who lack one particular value. Kind k holds value v when bit v is set.
 * How many users hold two values at once is left out: the owner accepted that the counts show it.
 */
function manyValue(kinds: number, values: number, rollUps: number[] = []): Secret[] {
  const holds = (bits: number) => (k: number) => (k & bits) > 0
  const all = (1 << values) - 1
  const out = [group('any', kinds, holds(all)), group('none', kinds, (k) => k === 0)]
  for (let v = 0; v < values; v++) out.push(group(`v${v}`, kinds, holds(1 << v)), group(`any but v${v}`, kinds, (k) => k > 0 && !holds(1 << v)(k)))
  rollUps.forEach((bits, g) => {
    out.push(group(`g${g}`, kinds, holds(bits)), group(`any but g${g}`, kinds, (k) => k > 0 && !holds(bits)(k)))
    for (let v = 0; v < values; v++) if (bits & (1 << v)) out.push(group(`g${g} but v${v}`, kinds, (k) => holds(bits)(k) && !holds(1 << v)(k)))
  })
  return out
}
const values = (counts: number[]) => counts.map((count, v) => ({ label: `v${v}`, count }))

export const shapes = {
  // Kinds: joined yesterday, earlier this week, earlier this month, before that.
  windows: {
    name: 'new-account windows',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), new1: p[0]!, new7: p[0]! + p[1]!, new30: p[0]! + p[1]! + p[2]! }),
    secrets: unions('joined', 4, 4, (k) => k),
  },
  // Kinds: holds value 0, 1 or 2, or none. One roll-up of values 0 and 1.
  single: {
    name: 'a one-value field with a roll-up',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), fields: [{ multiple: false, any: p[0]! + p[1]! + p[2]!, values: values([p[0]!, p[1]!, p[2]!]), groups: [{ label: 'g', count: p[0]! + p[1]!, members: [0, 1] }] }] }),
    secrets: unions('field', 4, 4, (k) => k),
  },
  // Kinds: holds value 0, 1, 2 or 3, or none. Two roll-ups that share value 0, the case where roll-ups pin a row down.
  overlap: {
    name: 'a one-value field with two roll-ups that share a value',
    kinds: 5,
    counts: (p) => ({
      ...none,
      total: sum(p),
      fields: [
        {
          multiple: false,
          any: sum(p) - p[4]!,
          values: values([p[0]!, p[1]!, p[2]!, p[3]!]),
          groups: [
            { label: 'g1', count: p[0]! + p[1]!, members: [0, 1] },
            { label: 'g2', count: p[0]! + p[2]!, members: [0, 2] },
          ],
        },
      ],
    }),
    secrets: unions('field', 5, 5, (k) => k),
  },
  // Kinds: every set of the three values a user can hold (kind k holds value v when bit v of k is set).
  multi: {
    name: 'a many-value field with a roll-up',
    kinds: 8,
    counts: (p) => ({
      ...none,
      total: sum(p),
      fields: [{ multiple: true, any: of(p, (k) => k > 0), values: values([0, 1, 2].map((v) => of(p, (k) => (k & (1 << v)) > 0))), groups: [{ label: 'g', count: of(p, (k) => (k & 6) > 0), members: [1, 2] }] }],
    }),
    secrets: manyValue(8, 3, [6]),
  },
  // Kinds: holds neither value, only value 0, only value 1, or both.
  twoValue: {
    name: 'a many-value field with two values',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), fields: [{ multiple: true, any: p[1]! + p[2]! + p[3]!, values: values([p[1]! + p[3]!, p[2]! + p[3]!]), groups: [] }] }),
    secrets: manyValue(4, 2),
  },
  // Kinds: owns 0, 1, 2 or 3 documents. Thresholds 0, 1 and 2.
  band: {
    name: 'a count band',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), bands: [{ counts: [p[1]! + p[2]! + p[3]!, p[2]! + p[3]!, p[3]!] }] }),
    secrets: unions('documents', 4, 4, (k) => k),
  },
  // Kinds: owns 0, 1, 2 or 3 documents. Two bands on the same field, thresholds 0 and 2, and 1 and 2. The plugin
  // refuses this at start-up; the shape is here to show why.
  twoBands: {
    name: 'two bands on one field',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), bands: [{ counts: [p[1]! + p[2]! + p[3]!, p[3]!] }, { counts: [p[2]! + p[3]!, p[3]!] }] }),
    secrets: unions('documents', 4, 4, (k) => k),
  },
  // Kinds: three sign-up ages times three document counts, so both ladders hang off the same total.
  windowsAndBand: {
    name: 'windows and a band together',
    kinds: 9,
    counts: (p) => ({ ...none, total: sum(p), new1: 0, new7: of(p, (k) => k % 3 === 0), new30: of(p, (k) => k % 3 <= 1), bands: [{ counts: [of(p, (k) => k >= 3), of(p, (k) => k >= 6)] }] }),
    secrets: [...unions('joined', 9, 3, (k) => k % 3), ...unions('documents', 9, 3, (k) => Math.floor(k / 3))],
  },
  // Kinds: field A (value 0, value 1, none) times field B (value 0, value 1, none), both one-value.
  twoFields: {
    name: 'two fields shown together',
    kinds: 9,
    counts: (p) => ({
      ...none,
      total: sum(p),
      fields: [0, 1].map((f) => {
        const at = (k: number) => (f ? Math.floor(k / 3) : k % 3)
        return { multiple: false, any: of(p, (k) => at(k) < 2), values: values([0, 1].map((v) => of(p, (k) => at(k) === v))), groups: [] }
      }),
    }),
    secrets: [...unions('field A', 9, 3, (k) => k % 3), ...unions('field B', 9, 3, (k) => Math.floor(k / 3))],
  },
} satisfies Record<string, Shape>

/** Every way to split `total` users across `kinds` kinds. */
function* splits(total: number, kinds: number, head: number[] = []): Generator<number[]> {
  if (kinds === 1) {
    yield [...head, total]
    return
  }
  for (let n = 0; n <= total; n++) yield* splits(total - n, kinds - 1, [...head, n])
}

export interface Leak {
  total: number
  page: string
  secret: string
  missing: number
  found: number[]
}

/** Runs the check. Returns every small group some page narrows, and how many sites and pages were looked at. */
export function leaks(shape: Shape, minimum: number, maxUsers: number, pageOf: Page = pageWith(), secrets: Secret[] = shape.secrets): { leaks: Leak[]; pages: number; sites: number } {
  if (maxUsers > 30) throw new Error('sizes are kept as bits of one number, so 30 users at most')
  const out: Leak[] = []
  const sizes = (bits: number) => Array.from({ length: maxUsers + 1 }, (_, v) => v).filter((v) => bits & (1 << v))
  let sites = 0
  let pages = 0
  for (let total = 0; total <= maxUsers; total++) {
    // What the public total alone allows each group to be: bit v is set when some site has v users in it.
    const possible = new Int32Array(secrets.length)
    const byPage = new Map<string, Int32Array>()
    for (const people of splits(total, shape.kinds)) {
      sites++
      const page = pageOf(shape.counts(people), minimum)
      let seen = byPage.get(page)
      if (!seen) byPage.set(page, (seen = new Int32Array(secrets.length)))
      for (const [i, s] of secrets.entries()) {
        const size = of(people, (k) => (s.mask & (1 << k)) > 0)
        possible[i]! |= 1 << size
        seen[i]! |= 1 << size
      }
    }
    pages += byPage.size
    const small = (1 << minimum) - 2 // sizes 1 to minimum - 1
    for (const [page, seen] of byPage)
      for (const [i, s] of secrets.entries()) {
        // Only a group that is small on some site behind this page has anything to protect.
        if (!(seen[i]! & small)) continue
        const missing = possible[i]! & small & ~seen[i]!
        if (missing) out.push({ total, page, secret: s.name, missing: sizes(missing)[0]!, found: sizes(seen[i]!) })
      }
  }
  return { leaks: out, pages, sites }
}
