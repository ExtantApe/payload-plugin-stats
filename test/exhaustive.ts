import { layout, type RawCounts } from '../src/report.js'
import type { Block, Cell, State } from '../src/suppress.js'

/**
 * A reader who knows the code. The hiding rule is public, so a reader can ask of any report: which sites would have
 * produced exactly this page? If every such site agrees that some small count is not 2, the page has given that away,
 * even when no arithmetic on the visible numbers would.
 *
 * This check builds every possible site of a shape, up to a number of users: every way to split the users across the
 * kinds of user that shape tells apart. It runs the engine on each, groups the sites by the page they produce, and
 * looks at each small count (1 to minimum - 1, rows nobody sees included). Every value from 1 to minimum - 1 that the
 * count could have on some site with the same total has to be found among the sites with the same page. The total is
 * public, so what the total alone rules out is not a leak.
 */

export type Engine = (cells: Cell[], blocks: Block[], minimum: number) => Map<string, State>

export interface Shape {
  name: string
  /** How many kinds of user the shape tells apart. */
  kinds: number
  /** The counts a site reports when it has `people[k]` users of kind k. */
  counts: (people: number[]) => RawCounts
}

const none = { new1: 0, new7: 0, new30: 0, fields: [], bands: [] }
const sum = (list: number[]) => list.reduce((s, n) => s + n, 0)
/** Users of the kinds whose number passes the test. */
const of = (people: number[], test: (kind: number) => boolean) => sum(people.filter((_, k) => test(k)))

export const shapes: Record<string, Shape> = {
  // Kinds: joined yesterday, earlier this week, earlier this month, before that.
  windows: { name: 'new-account windows', kinds: 4, counts: (p) => ({ ...none, total: sum(p), new1: p[0]!, new7: p[0]! + p[1]!, new30: p[0]! + p[1]! + p[2]! }) },
  // Kinds: holds value 0, 1 or 2, or none. One roll-up of values 0 and 1.
  single: {
    name: 'a one-value field with a roll-up',
    kinds: 4,
    counts: (p) => ({ ...none, total: sum(p), fields: [{ multiple: false, any: p[0]! + p[1]! + p[2]!, values: [0, 1, 2].map((v) => ({ label: `v${v}`, count: p[v]! })), groups: [{ label: 'g', count: p[0]! + p[1]!, members: [0, 1] }] }] }),
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
          values: [0, 1, 2, 3].map((v) => ({ label: `v${v}`, count: p[v]! })),
          groups: [
            { label: 'g1', count: p[0]! + p[1]!, members: [0, 1] },
            { label: 'g2', count: p[0]! + p[2]!, members: [0, 2] },
          ],
        },
      ],
    }),
  },
  // Kinds: every set of the three values a user can hold (kind k holds value v when bit v of k is set).
  multi: {
    name: 'a many-value field with a roll-up',
    kinds: 8,
    counts: (p) => ({
      ...none,
      total: sum(p),
      fields: [{ multiple: true, any: of(p, (k) => k > 0), values: [0, 1, 2].map((v) => ({ label: `v${v}`, count: of(p, (k) => (k & (1 << v)) > 0) })), groups: [{ label: 'g', count: of(p, (k) => (k & 6) > 0), members: [1, 2] }] }],
    }),
  },
  // Kinds: owns 0, 1, 2 or 3 documents. Thresholds 0, 1 and 2.
  band: { name: 'a count band', kinds: 4, counts: (p) => ({ ...none, total: sum(p), bands: [{ counts: [p[1]! + p[2]! + p[3]!, p[2]! + p[3]!, p[3]!] }] }) },
  // Kinds: three sign-up ages times three document counts, so both ladders hang off the same total.
  windowsAndBand: {
    name: 'windows and a band together',
    kinds: 9,
    counts: (p) => ({ ...none, total: sum(p), new1: 0, new7: of(p, (k) => k % 3 === 0), new30: of(p, (k) => k % 3 <= 1), bands: [{ counts: [of(p, (k) => k >= 3), of(p, (k) => k >= 6)] }] }),
  },
}

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
  cell: string
  missing: number
  found: number[]
}

/** Runs the check. Returns every small count some page narrows, and how many sites and pages were looked at. */
export function leaks(shape: Shape, minimum: number, maxUsers: number, engine: Engine): { leaks: Leak[]; pages: number; sites: number } {
  const out: Leak[] = []
  let sites = 0
  let pages = 0
  for (let total = 0; total <= maxUsers; total++) {
    // What the public total alone allows each count to be.
    const possible = new Map<string, Set<number>>()
    const byPage = new Map<string, Map<string, Set<number>>>()
    for (const people of splits(total, shape.kinds)) {
      sites++
      const { blocks, cells } = layout(shape.counts(people))
      const states = engine(cells, blocks, minimum)
      const page = cells
        .filter((c) => !c.implicit)
        .map((c) => `${c.id}=${states.get(c.id) === 'exact' ? c.value : states.get(c.id)}`)
        .join(' ')
      let seen = byPage.get(page)
      if (!seen) byPage.set(page, (seen = new Map()))
      for (const c of cells) {
        if (c.id === 'total') continue
        if (!possible.has(c.id)) possible.set(c.id, new Set())
        possible.get(c.id)!.add(c.value)
        if (!seen.has(c.id)) seen.set(c.id, new Set())
        seen.get(c.id)!.add(c.value)
      }
    }
    pages += byPage.size
    for (const [page, seen] of byPage)
      for (const [cell, found] of seen) {
        // Only a count that is small on some site behind this page has anything to protect.
        if (![...found].some((v) => v >= 1 && v < minimum)) continue
        for (let v = 1; v < minimum; v++)
          if (possible.get(cell)!.has(v) && !found.has(v)) {
            out.push({ total, page, cell, missing: v, found: [...found].sort((a, b) => a - b) })
            break
          }
      }
  }
  return { leaks: out, pages, sites }
}
