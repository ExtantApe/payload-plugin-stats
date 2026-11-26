import { describe, expect, it } from 'vitest'

import { layout, publish, type RawCounts } from '../src/report.js'
import { suppress, type Cell, type Line } from '../src/suppress.js'
import { narrowed } from './attacker.js'

const cells = (values: Record<string, number>, implicit: string[] = []): Cell[] => Object.entries(values).map(([id, value]) => ({ id, value, implicit: implicit.includes(id) }))
const run = (values: Record<string, number>, lines: Line[], minimum = 5, implicit: string[] = []) => Object.fromEntries(suppress(cells(values, implicit), lines, minimum))

describe('small counts', () => {
  it('hides every count under the minimum, zero included, and shows the rest', () => {
    expect(run({ a: 0, b: 1, c: 4, d: 5, e: 900 }, [])).toEqual({ a: 'small', b: 'small', c: 'small', d: 'exact', e: 'exact' })
  })

  it('follows the configured minimum', () => {
    expect(run({ a: 9, b: 10 }, [], 10)).toEqual({ a: 'small', b: 'exact' })
    expect(run({ a: 1, b: 2 }, [], 2)).toEqual({ a: 'small', b: 'exact' })
  })

  it('words a hidden count without the number', () => {
    expect(publish(3, 'small', 5)).toEqual({ value: null, hidden: 'small', text: 'fewer than 5' })
    expect(publish(48, 'protected', 5)).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    expect(publish(48, 'exact', 5)).toEqual({ value: 48, text: '48' })
  })
})

describe('complementary suppression', () => {
  const partition: Line[] = [{ kind: 'sum', parent: 'total', children: ['a', 'b', 'c'] }]

  it('hides a second row when one small row could be found by subtracting the others from the total', () => {
    // Without it: a = 100 - 7 - 91 = 2.
    expect(run({ total: 100, a: 2, b: 7, c: 91 }, partition)).toEqual({ total: 'exact', a: 'small', b: 'protected', c: 'exact' })
  })

  it('hides a third row when two would still pin the small one down', () => {
    // b is known to be 5 or more, so a + b = 7 would leave a at most 2.
    expect(run({ total: 100, a: 2, b: 5, c: 93 }, partition)).toEqual({ total: 'exact', a: 'small', b: 'protected', c: 'protected' })
  })

  it('leaves the table alone when nothing small is in it', () => {
    expect(run({ total: 100, a: 20, b: 30, c: 50 }, partition)).toEqual({ total: 'exact', a: 'exact', b: 'exact', c: 'exact' })
  })

  it('lets a zero be worked out, because a zero is nobody', () => {
    expect(run({ total: 100, a: 0, b: 30, c: 70 }, partition)).toEqual({ total: 'exact', a: 'small', b: 'exact', c: 'exact' })
  })

  it('needs no extra hiding when two small rows already cover for each other', () => {
    // a + b = 6 with both under 5 leaves each anywhere from 2 to 4... which rules out 1, so one more row goes.
    expect(run({ total: 100, a: 3, b: 3, c: 94 }, partition)).toEqual({ total: 'exact', a: 'small', b: 'small', c: 'protected' })
    // a + b = 5: each could be 1, 2, 3 or 4.
    expect(run({ total: 100, a: 2, b: 3, c: 95 }, partition)).toEqual({ total: 'exact', a: 'small', b: 'small', c: 'exact' })
  })

  it('hides a row when the total minus the row is a small group nobody listed', () => {
    // 48 of 50 hold the value: the 2 who do not are a small group, reachable by subtraction.
    const lines: Line[] = [{ kind: 'sum', parent: 'total', children: ['holders', 'rest'] }]
    expect(run({ total: 50, holders: 48, rest: 2 }, lines, 5, ['rest'])).toEqual({ total: 'exact', holders: 'protected' })
    expect(run({ total: 50, holders: 50, rest: 0 }, lines, 5, ['rest'])).toEqual({ total: 'exact', holders: 'exact' })
    expect(run({ total: 50, holders: 30, rest: 20 }, lines, 5, ['rest'])).toEqual({ total: 'exact', holders: 'exact' })
  })

  it('hides a rung of a ladder when the step between two rungs is small', () => {
    // more than 1: 20, more than 5: 18. The 2 users in between must not show.
    const lines: Line[] = [
      { kind: 'sum', parent: 'total', children: ['over1', 'upTo1'] },
      { kind: 'sum', parent: 'over1', children: ['over5', 'between'] },
    ]
    const out = run({ total: 100, over1: 20, over5: 18, upTo1: 80, between: 2 }, lines, 5, ['upTo1', 'between'])
    expect(out).toEqual({ total: 'exact', over1: 'exact', over5: 'protected' })
  })

  it('hides more when overlapping rows and their roll-up would pin a small row down', () => {
    // Staff 14, editors 10 shown: admins would be at least 4 and under 5, so exactly 4.
    const lines: Line[] = [{ kind: 'cover', parent: 'staff', children: ['admins', 'editors'] }]
    const out = run({ staff: 14, admins: 4, editors: 10 }, lines)
    expect(out.admins).toBe('small')
    expect([out.staff, out.editors]).toContain('protected')
  })

  it('still hides when the counts disagree (the data changed between two counts)', () => {
    // total says 10, the rows say 33. The small row keeps its cover and nothing throws.
    const out = run({ total: 10, a: 3, b: 30 }, [{ kind: 'sum', parent: 'total', children: ['a', 'b'] }])
    expect(out).toEqual({ total: 'exact', a: 'small', b: 'protected' })
  })

  it('says nothing about any size when there are too few users for the labels to be safe', () => {
    // 4 users, minimum 3. Hiding every number is not enough here: "fewer than 3" rows under a "hidden" total still
    // narrow the 1 older account. So every cell reads "hidden", with no hint of size.
    const { cells, lines } = layout({
      total: 4, new1: 0, new7: 1, new30: 3, bands: [],
      fields: [{ multiple: false, any: 2, groups: [], values: [{ label: 'a', count: 1 }, { label: 'b', count: 1 }] }],
    })
    const states = suppress(cells, lines, 3)
    expect([...new Set(states.values())]).toEqual(['withheld'])
    expect(narrowed(cells, lines, states, 3, 4)).toEqual([])
    expect(publish(2, 'withheld', 3)).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
  })

  it('refuses a line that names a cell it was not given', () => {
    expect(() => suppress(cells({ a: 1 }), [{ kind: 'sum', parent: 'a', children: ['nope'] }], 5)).toThrow(/unknown cell/)
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

describe('against a reader who tries every possibility', () => {
  const MIN = 3
  const cases: [string, Section[], number, number, number?][] = [
    ['new-account windows', ['time'], 14, 300],
    ['a one-value field with a roll-up', ['single'], 14, 300],
    ['a many-value field with a roll-up', ['multi'], 14, 300],
    ['a count band', ['band'], 14, 300],
    ['windows and a band together', ['time', 'band'], 12, 200],
    ['two fields together', ['single', 'multi'], 14, 120, 800_000],
    ['everything together', ['time', 'single', 'multi', 'band'], 14, 60, 400_000],
  ]
  it.each(cases)('%s: no small count can be narrowed down', (_name, sections, maxUsers, rounds, budget) => {
    let checked = 0
    let withheld = 0
    for (let seed = 1; seed <= rounds; seed++) {
      const raw = madeUp(seed, sections, maxUsers)
      const { cells, lines } = layout(raw)
      const states = suppress(cells, lines, MIN)
      // Nothing under the minimum is ever exact.
      for (const c of cells) if (!c.implicit && c.value < MIN) expect(states.get(c.id), `seed ${seed}: ${c.id}`).not.toBe('exact')
      if ([...states.values()].includes('withheld')) withheld++
      const found = narrowed(cells, lines, states, MIN, maxUsers + 2, budget)
      if (found === null) continue // too many possibilities to try them all
      checked++
      expect(found, `seed ${seed}: ${JSON.stringify(raw)}`).toEqual([])
    }
    expect(checked).toBeGreaterThan(rounds / 2)
    expect(withheld).toBeLessThan(rounds / 10) // the say-nothing fallback stays rare
  })

  it('the reader does catch a report with no complementary suppression', () => {
    // The check above would be worthless if the reader could not find a real leak.
    const { cells, lines } = layout({ total: 12, new1: 0, new7: 0, new30: 0, bands: [], fields: [{ multiple: false, any: 12, groups: [], values: [{ label: 'a', count: 2 }, { label: 'b', count: 10 }] }] })
    const naive = new Map(cells.filter((c) => !c.implicit).map((c) => [c.id, c.value < MIN ? ('small' as const) : ('exact' as const)]))
    expect(narrowed(cells, lines, naive, MIN, 14)).not.toEqual([])
  })
})
