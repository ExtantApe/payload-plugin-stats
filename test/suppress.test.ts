import { describe, expect, it } from 'vitest'

import { layout, publish, type RawCounts } from '../src/report.js'
import { suppress, type Block, type Cell, type State } from '../src/suppress.js'
import { narrowed } from './attacker.js'
import { leaks, shapes, type Engine } from './exhaustive.js'

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
  it('never shows a count under the minimum, and words a zero as "fewer than"', () => {
    const cells: Cell[] = [0, 1, 4, 5, 900].map((value, i) => ({ id: `c${i}`, value, block: `b${i}` }))
    const blocks: Block[] = cells.map((c) => ({ id: c.block! }))
    expect(Object.fromEntries(suppress(cells, blocks, 5))).toEqual({ c0: 'small', c1: 'hidden', c2: 'hidden', c3: 'exact', c4: 'exact' })
  })

  it('follows the configured minimum', () => {
    const run = (values: number[], minimum: number) => [...suppress(values.map((value, i) => ({ id: `c${i}`, value, block: `b${i}` })), values.map((_, i) => ({ id: `b${i}` })), minimum).values()]
    expect(run([9, 10], 10)).toEqual(['hidden', 'exact'])
    expect(run([1, 2], 2)).toEqual(['hidden', 'exact'])
  })

  it('words a hidden count without the number', () => {
    expect(publish(0, 'small', 5)).toEqual({ value: null, hidden: 'small', text: 'fewer than 5' })
    expect(publish(3, 'hidden', 5)).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(48, 'hidden', 5)).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(48, 'exact', 5)).toEqual({ value: 48, text: '48' })
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
      expect(out, `${a} ${b} ${c}`).toMatchObject({ 'f0.any': 'exact', 'f0.none': 'small', 'f0.v0': 'hidden', 'f0.v1': 'hidden', 'f0.v2': 'hidden' })
    }
  })

  it('leaves a table alone when nothing small is in it or reachable from it', () => {
    expect(shown({ total: 100, fields: [field(false, 100, [20, 30, 50])] })).toMatchObject({ 'f0.v0': 'exact', 'f0.v1': 'exact', 'f0.v2': 'exact' })
  })

  it('lets a zero be seen, because a zero is nobody', () => {
    expect(shown({ total: 100, fields: [field(false, 100, [0, 30, 70])] })).toMatchObject({ 'f0.v0': 'small', 'f0.v1': 'exact', 'f0.v2': 'exact' })
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
    expect(shown({ total: 100, bands: [{ counts: [20, 14, 0] }] })).toMatchObject({ 'b0.t0': 'exact', 'b0.t1': 'exact', 'b0.t2': 'small' })
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
const naive: Engine = (cells, _blocks, minimum) => new Map(cells.filter((c) => !c.implicit).map((c) => [c.id, c.value < minimum ? ('small' as State) : ('exact' as State)]))
/**
 * Closer to the first version: every small count reads "hidden", and so does one larger count in the same table,
 * the smallest one. No arithmetic on the page finds anything, but which neighbor was picked depends on the numbers.
 */
const pickedBySize: Engine = (cells, blocks, minimum) => {
  const out = new Map<string, State>(cells.filter((c) => !c.implicit).map((c) => [c.id, c.value >= 1 && c.value < minimum ? 'hidden' : c.value === 0 ? 'small' : 'exact']))
  for (const b of blocks) {
    const mine = cells.filter((c) => c.block === b.id && !c.implicit)
    if (!mine.some((c) => c.value >= 1 && c.value < minimum)) continue
    const pick = mine.filter((c) => c.value >= minimum).sort((x, y) => x.value - y.value || x.id.localeCompare(y.id))[0]
    if (pick) out.set(pick.id, 'hidden')
  }
  return out
}

/** The real engine with one design choice undone: a hidden count under the minimum still reads "fewer than". */
const labelsInHiddenTables: Engine = (cells, blocks, minimum) => {
  const out = suppress(cells, blocks, minimum)
  for (const c of cells) if (!c.implicit && out.get(c.id) === 'hidden' && c.value < minimum) out.set(c.id, 'small')
  return out
}
/** The real engine with another undone: no nesting, so rows can show under a hidden "any" and rungs under a hidden rung. */
const noNesting: Engine = (cells, blocks, minimum) => suppress(cells, blocks.map(({ id, broken }) => ({ id, ...(broken ? { broken } : {}) })), minimum)

describe('against a reader who knows the code: every possible site', () => {
  // [shape, largest site in users]. Every split of the users is tried, at each minimum.
  const cases: [keyof typeof shapes, number][] = [['windows', 20], ['single', 20], ['overlap', 15], ['multi', 12], ['band', 20], ['windowsAndBand', 9]]
  for (const minimum of [2, 3, 5])
    it.each(cases)(`%s, minimum ${minimum}: no page narrows a small count`, (key, maxUsers) => {
      const result = leaks(shapes[key]!, minimum, maxUsers, suppress)
      expect(result.leaks.slice(0, 3)).toEqual([])
      expect(result.sites).toBeGreaterThan(1000)
      // The check would mean little if nearly every site gave the same all-hidden page.
      expect(result.pages).toBeGreaterThan(20)
    })

  it('the check does catch an engine that hides small counts and nothing else', () => {
    expect(leaks(shapes.single!, 5, 14, naive).leaks.length).toBeGreaterThan(0)
    expect(leaks(shapes.band!, 5, 14, naive).leaks.length).toBeGreaterThan(0)
  })

  it('the check does catch "fewer than" labels inside a hidden table, and blocks that are not nested', () => {
    // Both were tried while designing the engine. Each leaks on every shape, which is why hidden says nothing of size.
    for (const key of ['windows', 'single', 'band'] as const) {
      expect(leaks(shapes[key]!, 5, 12, labelsInHiddenTables).leaks.length, key).toBeGreaterThan(0)
      expect(leaks(shapes[key]!, 5, 12, noNesting).leaks.length, key).toBeGreaterThan(0)
    }
  })

  it('the check does catch an engine that picks what to hide by size', () => {
    expect(leaks(shapes.single!, 5, 14, pickedBySize).leaks.length).toBeGreaterThan(0)
    expect(leaks(shapes.multi!, 5, 10, pickedBySize).leaks.length).toBeGreaterThan(0)
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

type Section = 'band' | 'multi' | 'single' | 'time'

/** Counts for a made-up population, built exactly the way the plugin lays a report out. */
function madeUp(seed: number, sections: Section[], maxUsers: number): RawCounts {
  const rnd = random(seed)
  const pick = (n: number) => Math.floor(rnd() * n)
  const people = Array.from({ length: pick(maxUsers + 1) }, () => ({
    age: pick(6), // 0 yesterday, 1 this week, 2 this month, 3 and up older
    single: pick(4), // 3 is "not set"
    multi: [rnd() < 0.7, rnd() < 0.4, rnd() < 0.15],
    docs: pick(7),
  }))
  const n = (test: (p: (typeof people)[number]) => boolean) => people.filter(test).length
  const raw: RawCounts = { total: people.length, new1: 0, new7: 0, new30: 0, fields: [], bands: [] }
  if (sections.includes('time')) Object.assign(raw, { new1: n((p) => p.age === 0), new7: n((p) => p.age <= 1), new30: n((p) => p.age <= 2) })
  if (sections.includes('single')) {
    const values = [0, 1, 2].map((v) => ({ label: `v${v}`, count: n((p) => p.single === v) }))
    raw.fields.push({ multiple: false, any: n((p) => p.single < 3), values, groups: [{ label: 'g', count: values[0]!.count + values[1]!.count, members: [0, 1] }] })
  }
  if (sections.includes('multi')) {
    const values = [0, 1, 2].map((v) => ({ label: `v${v}`, count: n((p) => p.multi[v]!) }))
    raw.fields.push({ multiple: true, any: n((p) => p.multi.some(Boolean)), values, groups: [{ label: 'g', count: n((p) => p.multi[1]! || p.multi[2]!), members: [1, 2] }] })
  }
  if (sections.includes('band')) raw.bands.push({ counts: [0, 2, 4].map((t) => n((p) => p.docs > t)) })
  return raw
}

describe('against a reader who only does arithmetic: random larger sites', () => {
  const cases: [string, Section[], number, number?][] = [
    ['new-account windows', ['time'], 300],
    ['a one-value field with a roll-up', ['single'], 300],
    ['a many-value field with a roll-up', ['multi'], 300],
    ['a count band', ['band'], 300],
    ['windows and a band together', ['time', 'band'], 200],
    ['two fields together', ['single', 'multi'], 150],
    ['everything together', ['time', 'single', 'multi', 'band'], 100],
  ]
  // [minimum, largest site]. The first version ran this at 3 only, and failed it at 5.
  for (const [minimum, maxUsers] of [[3, 14], [5, 18]] as const)
    it.each(cases)(`%s, minimum ${minimum}: no small count can be narrowed down`, (_name, sections, rounds, budget) => {
      let checked = 0
      let showing = 0
      for (let seed = 1; seed <= rounds; seed++) {
        const raw = madeUp(seed, sections, maxUsers)
        const { blocks, cells, lines } = layout(raw)
        const states = suppress(cells, blocks, minimum)
        // The total is always exact, and nothing else under the minimum ever is.
        expect(states.get('total')).toBe('exact')
        for (const c of cells) if (!c.implicit && c.id !== 'total' && c.value < minimum) expect(states.get(c.id), `seed ${seed}: ${c.id}`).not.toBe('exact')
        if ([...states].some(([id, state]) => id !== 'total' && state === 'exact')) showing++
        const found = narrowed(cells, lines, states, minimum, raw.total, budget)
        if (found === null) continue // too many possibilities to try them all
        checked++
        expect(found, `seed ${seed}: ${JSON.stringify(raw)}`).toEqual([])
      }
      expect(checked).toBeGreaterThan(rounds * 0.9)
      expect(showing).toBeGreaterThan(rounds / 10) // not every report is all hidden
    })

  it('the reader does catch a report with no complementary hiding', () => {
    // The check above would be worthless if the reader could not find a real leak.
    const { cells, lines } = layout({ total: 12, new1: 0, new7: 0, new30: 0, bands: [], fields: [{ multiple: false, any: 12, groups: [], values: [{ label: 'a', count: 2 }, { label: 'b', count: 10 }] }] })
    expect(narrowed(cells, lines, naive(cells, [], 5), 5, 12)).not.toEqual([])
  })
})
