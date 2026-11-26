import { describe, expect, it } from 'vitest'

import { layout, present, publish, type Engine, type RawCounts } from '../src/report.js'
import { suppress, type Block, type Cell, type State } from '../src/suppress.js'
import { narrowed, numbers, published } from './attacker.js'
import { group, leaks, pageWith, shapes, unions, type Page, type Shape } from './exhaustive.js'

const none = { new1: 0, new7: 0, new30: 0, fields: [], bands: [] }
/** What a report with these counts shows, by cell id. */
const shown = (raw: Partial<RawCounts> & { total: number }, minimum = 5) => {
  const { blocks, cells } = layout({ ...none, ...raw })
  return Object.fromEntries(suppress(cells, blocks, minimum))
}
const field = (multiple: boolean, any: number, values: number[], groups: { count: number; members: number[] }[] = []) => ({
  multiple,
  any,
  values: values.map((count, j) => ({ label: `v${j}`, count })),
  groups: groups.map((g, k) => ({ label: `g${k}`, ...g })),
})

describe('small counts', () => {
  it('never shows a count from 1 to minimum - 1, and shows a zero as 0', () => {
    const cells: Cell[] = [0, 1, 4, 5, 900].map((value, i) => ({ id: `c${i}`, value, block: `b${i}` }))
    const blocks: Block[] = cells.map((c) => ({ id: c.block! }))
    expect(Object.fromEntries(suppress(cells, blocks, 5))).toEqual({ c0: 'exact', c1: 'hidden', c2: 'hidden', c3: 'exact', c4: 'exact' })
  })

  it('follows the configured minimum', () => {
    const run = (values: number[], minimum: number) => [...suppress(values.map((value, i) => ({ id: `c${i}`, value, block: `b${i}` })), values.map((_, i) => ({ id: `b${i}` })), minimum).values()]
    expect(run([9, 10], 10)).toEqual(['hidden', 'exact'])
    expect(run([1, 2], 2)).toEqual(['hidden', 'exact'])
  })

  it('words a hidden count without the number', () => {
    expect(publish(3, 'hidden')).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(48, 'hidden')).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(0, 'hidden')).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(48, 'exact')).toEqual({ value: 48, text: '48' })
  })

  it('shows a zero in a table that shows as 0, never as "fewer than"', () => {
    expect(publish(0, 'exact')).toEqual({ value: 0, text: '0' })
    // Nobody lacks a value and nobody holds value 0: both read 0. Nobody joined in 30 days: the whole list reads 0.
    const page = present({ ...none, total: 100, fields: [field(false, 100, [0, 30, 70])] }, 5)
    expect(page.fields[0]).toMatchObject({ none: { value: 0, text: '0' }, values: [{ value: 0, text: '0' }, { value: 30 }, { value: 70 }] })
    expect(page.totals).toMatchObject({ new30Days: { value: 0, text: '0' }, new7Days: { text: '0' }, newYesterday: { text: '0' } })
    expect(JSON.stringify(page)).not.toContain('fewer')
    // A zero in a hidden table stays hidden with it.
    expect(present({ ...none, total: 100, fields: [field(false, 100, [0, 3, 97])] }, 5).fields[0]!.values.map((v) => v.text)).toEqual(['hidden', 'hidden', 'hidden'])
  })
})

describe('the total is public', () => {
  it('always shows the total, even when it is under the minimum or everything else is hidden', () => {
    for (const total of [0, 1, 3, 4, 5, 40]) expect(shown({ total, new30: Math.min(total, 2), new7: Math.min(total, 1) }).total).toBe('exact')
    expect(shown({ total: 3, new30: 2, new7: 1, new1: 1 })).toEqual({ total: 'exact', new30: 'hidden', new7: 'hidden', new1: 'hidden' })
  })
})

describe('hiding by structure', () => {
  it('hides every row of a table when one row is small, whatever the other rows are', () => {
    // The old engine hid one neighbor, chosen by size, and which one it chose gave the small count away.
    for (const [a, b, c] of [[4, 14, 5], [3, 14, 5], [2, 14, 6], [1, 5, 14], [4, 5, 5]] as const) {
      const out = shown({ total: a + b + c, fields: [field(false, a + b + c, [a, b, c])] })
      expect(out, `${a} ${b} ${c}`).toMatchObject({ 'f0.any': 'exact', 'f0.none': 'exact', 'f0.v0': 'hidden', 'f0.v1': 'hidden', 'f0.v2': 'hidden' })
    }
  })

  it('leaves a table alone when nothing small is in it or reachable from it', () => {
    expect(shown({ total: 100, fields: [field(false, 100, [20, 30, 50])] })).toMatchObject({ 'f0.v0': 'exact', 'f0.v1': 'exact', 'f0.v2': 'exact' })
  })

  it('lets a zero be seen, because a zero is nobody', () => {
    expect(shown({ total: 100, fields: [field(false, 100, [0, 30, 70])] })).toMatchObject({ 'f0.v0': 'exact', 'f0.v1': 'exact', 'f0.v2': 'exact' })
  })

  it('hides the whole field when "any" or "none" is small, and only the rows when a row is', () => {
    // 48 of 50 hold a value: the 2 who do not are a small group, so "any", "none" and every row go.
    expect(shown({ total: 50, fields: [field(false, 48, [20, 28])] })).toMatchObject({ 'f0.any': 'hidden', 'f0.none': 'hidden', 'f0.v0': 'hidden', 'f0.v1': 'hidden' })
    expect(shown({ total: 50, fields: [field(false, 40, [3, 37])] })).toMatchObject({ 'f0.any': 'exact', 'f0.none': 'exact', 'f0.v0': 'hidden', 'f0.v1': 'hidden' })
  })

  it('hides the rows when everyone but a few holds one overlapping value', () => {
    // 30 hold some role and 28 hold role 0: the 2 who hold a role but not that one are a small group nobody listed.
    expect(shown({ total: 40, fields: [field(true, 30, [28, 10])] })).toMatchObject({ 'f0.any': 'exact', 'f0.none': 'exact', 'f0.v0': 'hidden', 'f0.v1': 'hidden' })
    expect(shown({ total: 40, fields: [field(true, 30, [25, 10])] })).toMatchObject({ 'f0.v0': 'exact', 'f0.v1': 'exact' })
  })

  it('hides the rows when a roll-up, or what is left outside it, is small', () => {
    // Staff 14 with editors 10 and admins 4: a small row.
    expect(shown({ total: 40, fields: [field(true, 30, [4, 10, 25], [{ count: 14, members: [0, 1] }])] })['f0.g0']).toBe('hidden')
    // Roll-up 27 of 30: the 3 outside it are small, though every row is large.
    expect(shown({ total: 40, fields: [field(false, 30, [13, 14, 3], [{ count: 27, members: [0, 1] }])] })['f0.g0']).toBe('hidden')
    expect(shown({ total: 40, fields: [field(false, 30, [10, 10, 10], [{ count: 20, members: [0, 1] }])] })).toMatchObject({ 'f0.g0': 'exact', 'f0.v2': 'exact' })
  })

  it('shows a ladder from the top down to the first small count or small step, and hides it from there on', () => {
    // 2 joined yesterday: only that row goes.
    expect(shown({ total: 40, new30: 20, new7: 9, new1: 2 })).toEqual({ total: 'exact', new30: 'exact', new7: 'exact', new1: 'hidden' })
    // 18 in 30 days, 16 in 7: the 2 between are small, so the 7-day row and everything under it go.
    expect(shown({ total: 40, new30: 18, new7: 16, new1: 8 })).toEqual({ total: 'exact', new30: 'exact', new7: 'hidden', new1: 'hidden' })
    // 38 of 40 in 30 days: the 2 older accounts are small, so the whole ladder goes.
    expect(shown({ total: 40, new30: 38, new7: 16, new1: 8 })).toEqual({ total: 'exact', new30: 'hidden', new7: 'hidden', new1: 'hidden' })
    // More than 1: 20, more than 5: 18, more than 10: 9.
    expect(shown({ total: 100, bands: [{ counts: [20, 18, 9] }] })).toMatchObject({ 'b0.t0': 'exact', 'b0.t1': 'hidden', 'b0.t2': 'hidden' })
    expect(shown({ total: 100, bands: [{ counts: [20, 14, 0] }] })).toMatchObject({ 'b0.t0': 'exact', 'b0.t1': 'exact', 'b0.t2': 'exact' })
  })

  it('hides a table whose counts disagree (the data changed between two counts)', () => {
    // More holders than users, rows that do not add up, a rung above the one before it.
    expect(shown({ total: 10, fields: [field(false, 33, [3, 30])] })).toMatchObject({ total: 'exact', 'f0.any': 'hidden', 'f0.none': 'hidden', 'f0.v1': 'hidden' })
    expect(shown({ total: 100, fields: [field(false, 50, [20, 20])] })).toMatchObject({ 'f0.any': 'exact', 'f0.v0': 'hidden', 'f0.v1': 'hidden' })
    expect(shown({ total: 100, fields: [field(true, 50, [20, 20])] })).toMatchObject({ 'f0.any': 'exact', 'f0.v0': 'hidden', 'f0.v1': 'hidden' })
    expect(shown({ total: 100, new30: 20, new7: 30, new1: 10 })).toEqual({ total: 'exact', new30: 'exact', new7: 'hidden', new1: 'hidden' })
  })

  it('refuses a cell that names a block it was not given, and a block nested inside itself', () => {
    expect(() => suppress([{ id: 'a', value: 1, block: 'nope' }], [], 5)).toThrow(/unknown block/)
    expect(() => suppress([{ id: 'a', value: 9, block: 'x' }], [{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }], 5)).toThrow(/nested inside itself/)
  })
})

/** The first version's idea, kept only to prove the checks below can see a leak: hide small counts and nothing else. */
const naive: Engine = (cells, _blocks, minimum) => new Map(cells.filter((c) => !c.implicit).map((c) => [c.id, c.value >= 1 && c.value < minimum ? ('hidden' as State) : ('exact' as State)]))
/**
 * Closer to the first version: every small count reads "hidden", and so does one larger count in the same table,
 * the smallest one. No arithmetic on the page finds anything, but which neighbor was picked depends on the numbers.
 */
const pickedBySize: Engine = (cells, blocks, minimum) => {
  const out = naive(cells, blocks, minimum)
  for (const b of blocks) {
    const mine = cells.filter((c) => c.block === b.id && !c.implicit)
    if (!mine.some((c) => c.value >= 1 && c.value < minimum)) continue
    const pick = mine.filter((c) => c.value >= minimum).sort((x, y) => x.value - y.value || x.id.localeCompare(y.id))[0]
    if (pick) out.set(pick.id, 'hidden')
  }
  return out
}
/** The real engine with one design choice undone: no nesting, so rows can show under a hidden "any" and rungs under a hidden rung. */
const noNesting: Engine = (cells, blocks, minimum) => suppress(cells, blocks.map(({ id, broken }) => ({ id, ...(broken ? { broken } : {}) })), minimum)
/** The real page with another undone: a hidden count under the minimum reads "fewer than", as the first version's did. */
const labelsInHiddenTables: Page = (raw, minimum) => {
  const truth = numbers(raw)
  return published(present(raw, minimum)).map((v, i) => v ?? (truth[i]! < minimum ? 'fewer' : 'hidden')).join(' ')
}

describe('against a reader who knows the code: every possible site', () => {
  // [shape, largest site in users]. Every split of the users is tried, at each minimum.
  const cases: [keyof typeof shapes, number][] = [['windows', 20], ['single', 20], ['overlap', 15], ['multi', 12], ['twoValue', 24], ['band', 20], ['windowsAndBand', 9], ['twoFields', 9]]
  for (const minimum of [2, 3, 5])
    it.each(cases)(`%s, minimum ${minimum}: no page narrows a small group`, (key, maxUsers) => {
      const result = leaks(shapes[key], minimum, maxUsers)
      expect(result.leaks.slice(0, 3)).toEqual([])
      expect(result.sites).toBeGreaterThan(1000)
      // The check would mean little if nearly every site gave the same all-hidden page.
      expect(result.pages).toBeGreaterThan(20)
    })

  it('the check does catch an engine that hides small counts and nothing else', () => {
    expect(leaks(shapes.single, 5, 14, pageWith(naive)).leaks.length).toBeGreaterThan(0)
    expect(leaks(shapes.band, 5, 14, pageWith(naive)).leaks.length).toBeGreaterThan(0)
  })

  it('the check does catch "fewer than" labels inside a hidden table, and blocks that are not nested', () => {
    // Both were tried while designing the engine. Each leaks on every shape, which is why hidden says nothing of size.
    for (const key of ['windows', 'single', 'band'] as const) {
      expect(leaks(shapes[key], 5, 12, labelsInHiddenTables).leaks.length, key).toBeGreaterThan(0)
      expect(leaks(shapes[key], 5, 12, pageWith(noNesting)).leaks.length, key).toBeGreaterThan(0)
    }
  })

  it('the check does catch an engine that picks what to hide by size', () => {
    expect(leaks(shapes.single, 5, 14, pageWith(pickedBySize)).leaks.length).toBeGreaterThan(0)
    expect(leaks(shapes.multi, 5, 10, pageWith(pickedBySize)).leaks.length).toBeGreaterThan(0)
  })

  it('the check does catch two bands on one field, which is why the plugin refuses them at start-up', () => {
    // "More than 0" from one band less "more than 1" from the other is the users with exactly one document.
    const found = leaks(shapes.twoBands, 5, 14).leaks
    expect(found.length).toBeGreaterThan(0)
    // The review's case: 6 with more than 0 and 5 with more than 1, so exactly 1 user has one document.
    const page = present(shapes.twoBands.counts([10, 1, 2, 3]), 5)
    expect(page.bands.map((b) => b!.map((c) => c.text))).toEqual([['6', 'hidden'], ['5', 'hidden']])
    expect(narrowed(shapes.twoBands, [10, 1, 2, 3], 5)).toContain('documents parts 0010 (really 1) cannot be 2')
  })
})

describe('accepted limits, pinned so a change to either one shows up here', () => {
  /** Every group a reader could name from a two-value field, the overlap included. */
  const everyGroup = unions('field', 4, 4, (k) => k)
  const both = group('both values', 4, (k) => k === 3)

  it('a many-value field shows how many users hold two of its values (the owner accepted this)', () => {
    // The review's case: 10 hold neither role, 10 only the first, 8 only the second, 2 both.
    const page = present(shapes.twoValue.counts([10, 10, 8, 2]), 5)
    expect(page.fields[0]).toMatchObject({ any: { value: 20 }, none: { value: 10 }, values: [{ value: 12 }, { value: 10 }] })
    // 12 + 10 - 20 = 2 hold both, and the reader works that out.
    expect(narrowed({ ...shapes.twoValue, secrets: [both] }, [10, 10, 8, 2], 5)).toEqual(['both values (really 2) cannot be 1'])
  })

  it('and that overlap is all it gives away: every other group a reader could name stays protected', () => {
    // At minimum 2 the only small size is 1, so there is no smaller range to narrow to and the check has nothing to find.
    for (const minimum of [3, 5]) {
      const found = leaks(shapes.twoValue, minimum, 24, undefined, everyGroup).leaks
      expect(found.length).toBeGreaterThan(0)
      // Parts, right to left: neither, only the first value, only the second, both. What leaks is "both", on its own
      // and counted together with "neither", a number the page shows.
      expect([...new Set(found.map((l) => l.secret))].sort()).toEqual(['field parts 1000', 'field parts 1001'])
    }
  })

  it('two tables side by side can narrow a group that spans both (the README says so)', () => {
    // With 8 users, 5 holding A's first value and 5 holding B's first value, at least 2 hold both.
    const spanning: Shape = { ...shapes.twoFields, secrets: [group('A value 0 and B value 0', 9, (k) => k === 0)] }
    expect(leaks(spanning, 3, 8).leaks.length).toBeGreaterThan(0)
  })
})

/** A small repeatable random source, so a failure can be replayed from its seed. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A made-up site of a shape: for each kind of user, nobody, a few, or a crowd. */
function madeUp(seed: number, shape: Shape, minimum: number): number[] {
  const rnd = random(seed)
  const pick = (n: number) => Math.floor(rnd() * n)
  return Array.from({ length: shape.kinds }, () => {
    const roll = rnd()
    return roll < 0.25 ? 0 : roll < 0.45 ? 1 + pick(minimum - 1) : minimum + pick(20)
  })
}

describe('against a reader who only does arithmetic: random larger sites', () => {
  const cases: [keyof typeof shapes, number][] = [['windows', 300], ['single', 300], ['overlap', 300], ['multi', 200], ['twoValue', 300], ['band', 300], ['windowsAndBand', 150], ['twoFields', 150]]
  // The first version ran this at 3 only, and failed it at 5.
  for (const minimum of [3, 5])
    it.each(cases)(`%s, minimum ${minimum}: no small group can be narrowed down`, (key, rounds) => {
      const shape: Shape = shapes[key]
      let checked = 0
      let showing = 0
      for (let seed = 1; seed <= rounds; seed++) {
        const people = madeUp(seed, shape, minimum)
        const raw = shape.counts(people)
        const page = published(present(raw, minimum))
        // The total is always exact, and no number from 1 to minimum - 1 is ever on the page.
        expect(page[0]).toBe(raw.total)
        for (const v of page.slice(1)) expect(v === null || v === 0 || v >= minimum, `seed ${seed}: ${v}`).toBe(true)
        if (page.slice(1).some((v) => v !== null)) showing++
        const found = narrowed(shape, people, minimum)
        if (found === null) continue // too many possibilities to try them all
        checked++
        expect(found, `seed ${seed}: ${JSON.stringify(people)}`).toEqual([])
      }
      expect(checked).toBeGreaterThan(rounds * 0.9)
      expect(showing).toBeGreaterThan(rounds / 10) // not every report is all hidden
    })

  it('the reader does catch a report with no complementary hiding', () => {
    // The check above would be worthless if the reader could not find a real leak. 2, 10 and 0 hold the three values.
    const people = [2, 10, 0, 0]
    expect(narrowed(shapes.single, people, 5, published(present(shapes.single.counts(people), 5, naive)))).not.toEqual([])
  })
})
