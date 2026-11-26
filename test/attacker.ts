import { present, type RawCounts, type Shown } from '../src/report.js'
import type { Shape } from './exhaustive.js'

/**
 * A reader with unlimited patience who only does arithmetic. It is given a page (the numbers a report shows, and
 * which ones are hidden) and what each number counts, in terms of made-up kinds of user. It does not know the hiding
 * rule and reads nothing of how the plugin lays a report out. For each protected group that is small on the true
 * site, it asks whether some site fits every shown number with 1 user in the group, with 2, and so on. A size with no
 * fitting site has been ruled out by the page.
 */

/** The true numbers behind a report, in a fixed order. "None" is the total less "any". */
export function numbers(raw: RawCounts): number[] {
  return [
    raw.total,
    raw.new1,
    raw.new7,
    raw.new30,
    ...raw.fields.flatMap((f) => (f.unavailable ? [] : [f.any, raw.total - f.any, ...f.groups.map((g) => g.count), ...f.values.map((v) => v.count)])),
    ...raw.bands.flatMap((b) => (b.unavailable ? [] : b.counts)),
  ]
}

/** The same numbers as a page shows them, in the same order: null when hidden. */
export function published(shown: Shown): (null | number)[] {
  const t = shown.totals
  return [t.all, t.newYesterday, t.new7Days, t.new30Days, ...shown.fields.flatMap((f) => (f ? [f.any, f.none, ...f.groups, ...f.values] : [])), ...shown.bands.flatMap((b) => b ?? [])].map((c) => c.value)
}

interface Fact {
  mask: number
  value: number
}

/** Is there a site, some number of users of each kind, where every fact holds? Null when the budget runs out. */
function fits(kinds: number, total: number, facts: Fact[], budget: { left: number }, down = false): boolean | null {
  const last = facts.map((f) => 31 - Math.clz32(f.mask))
  const sums = facts.map(() => 0)
  const place = (k: number, left: number): boolean | null => {
    if (k === kinds) return left === 0
    const first = k === kinds - 1 ? left : 0
    for (let step = 0; step <= left - first; step++) {
      const n = down ? left - step : first + step
      if (--budget.left < 0) return null
      let ok = true
      for (const [i, f] of facts.entries()) {
        if (!(f.mask & (1 << k))) continue
        const s = sums[i]! + n
        // Over the number, short of it with no kind left to add, or short by more than the users left.
        if (s > f.value || (last[i] === k && s !== f.value) || f.value - s > left - n) ok = false
      }
      if (!ok) continue
      for (const [i, f] of facts.entries()) if (f.mask & (1 << k)) sums[i]! += n
      const found = place(k + 1, left - n)
      for (const [i, f] of facts.entries()) if (f.mask & (1 << k)) sums[i]! -= n
      if (found !== false) return found
    }
    return false
  }
  return place(0, total)
}

/**
 * The protected groups the reader can narrow on the site with `people[k]` users of kind k. `page` is what that site
 * shows; by default, what the plugin publishes. Null when some question took more than `tries` steps to settle.
 */
export function narrowed(shape: Shape, people: number[], minimum: number, page?: (null | number)[], tries = 500_000): null | string[] {
  const raw = shape.counts(people)
  const truth = numbers(raw)
  const shown = page ?? published(present(raw, minimum))
  const total = people.reduce((s, n) => s + n, 0)
  // What each number counts: the kinds whose users it goes up by one for.
  const one = Array.from({ length: shape.kinds }, (_, k) => numbers(shape.counts(people.map((_, j) => (j === k ? 1 : 0)))))
  const masks = truth.map((_, i) => one.reduce((m, row, k) => m | (row[i]! << k), 0))
  for (const [i, t] of truth.entries()) {
    if (one.some((row) => row[i]! !== 0 && row[i]! !== 1) || people.reduce((s, n, k) => s + n * one[k]![i]!, 0) !== t) throw new Error(`number ${i} is not a plain count of kinds`)
    if (shown[i] !== null && shown[i] !== t) throw new Error(`number ${i} is shown as ${shown[i]} and is really ${t}`)
  }
  const facts = shown.flatMap((value, i) => (value === null ? [] : [{ mask: masks[i]!, value }]))
  const out: string[] = []
  for (const s of shape.secrets) {
    const size = people.reduce((sum, n, k) => sum + (s.mask & (1 << k) ? n : 0), 0)
    if (size < 1 || size >= minimum) continue
    for (let v = 1; v < minimum && v <= total; v++) {
      // Two searches, one filling the early kinds first and one the late kinds: a fit one misses the other often finds.
      const asked = [...facts, { mask: s.mask, value: v }]
      const found = fits(shape.kinds, total, asked, { left: tries }) ?? fits(shape.kinds, total, asked, { left: tries }, true)
      if (found === null) return null
      if (!found) {
        out.push(`${s.name} (really ${size}) cannot be ${v}`)
        break
      }
    }
  }
  return out
}
