import type { Line } from '../src/report.js'
import type { Cell, State } from '../src/suppress.js'

/**
 * A reader with unlimited patience. Given only what a report publishes (exact numbers, "fewer than" labels, "hidden"
 * labels) and how the report is built (the lines), it tries every whole-number filling of the unknown cells and keeps
 * the ones where all the arithmetic works. Returns, for each cell, every value it could still have.
 *
 * It shares no code with the hiding engine, and it does not know the engine's rule: it only does arithmetic. The
 * exhaustive check in exhaustive.ts covers a reader who knows the rule too. `cap` is the largest value any count can
 * have, which is the public total. Returns null when there are too many fillings to try within the budget.
 */
export function possibleValues(cells: Cell[], lines: Line[], states: Map<string, State>, minimum: number, cap: number, budget = 2_000_000): Map<string, Set<number>> | null {
  const explicit = cells.filter((c) => !c.implicit)
  const unknown = explicit.filter((c) => states.get(c.id) !== 'exact')
  const order = new Map(unknown.map((c, i) => [c.id, i]))
  const range = (c: Cell): [number, number] => (states.get(c.id) === 'small' ? [0, Math.min(minimum - 1, cap)] : [0, cap])

  // Each implicit cell is defined by one sum line: parent = the other children + it.
  const implicit = new Map(cells.filter((c) => c.implicit).map((c) => [c.id, lines.find((l) => l.kind === 'sum' && l.children.includes(c.id))!]))

  const value = new Map<string, number>()
  for (const c of explicit) if (states.get(c.id) === 'exact') value.set(c.id, c.value)
  const read = (id: string): number => {
    const line = implicit.get(id)
    return line ? read(line.parent) - line.children.filter((k) => k !== id).reduce((s, k) => s + read(k), 0) : value.get(id)!
  }
  // The depth at which every number a line needs has been filled in, so a wrong branch is dropped early.
  const needs = (id: string): number => {
    const line = implicit.get(id)
    return line ? Math.max(needs(line.parent), ...line.children.filter((k) => k !== id).map(needs)) : (order.get(id) ?? -1)
  }
  const holds = (line: Line) => {
    const members = [line.parent, ...line.children].map(read)
    if (members.some((v) => v < 0)) return false
    const sum = members.slice(1).reduce((s, v) => s + v, 0)
    return line.kind === 'sum' ? members[0] === sum : members[0]! <= sum
  }
  const readyAt = lines.map((l) => Math.max(...[l.parent, ...l.children].map(needs)))
  if (lines.some((l, i) => readyAt[i] === -1 && !holds(l))) return new Map(cells.map((c) => [c.id, new Set<number>()]))

  const seen = new Map(cells.map((c) => [c.id, new Set<number>()]))
  let visited = 0
  const fill = (i: number): boolean => {
    if (i === unknown.length) {
      for (const c of cells) seen.get(c.id)!.add(read(c.id))
      return true
    }
    const [lo, hi] = range(unknown[i]!)
    for (let v = lo; v <= hi; v++) {
      if (++visited > budget) return false
      value.set(unknown[i]!.id, v)
      if (lines.every((l, k) => readyAt[k] !== i || holds(l)) && !fill(i + 1)) return false
    }
    return true
  }
  return fill(0) ? seen : null
}

/**
 * Sensitive cells the reader can narrow: some value from 1 to minimum - 1 that fits under the public total has been
 * ruled out. The report is split into parts that share no unknown number, so each part can be tried on its own.
 */
export function narrowed(cells: Cell[], lines: Line[], states: Map<string, State>, minimum: number, total: number, budget?: number): null | string[] {
  const unknown = (id: string) => states.get(id) !== 'exact'
  const part = new Map<string, string>()
  const find = (id: string): string => {
    const up = part.get(id)
    if (up === undefined || up === id) return id
    const root = find(up)
    part.set(id, root)
    return root
  }
  for (const line of lines) {
    const ids = [line.parent, ...line.children].filter(unknown)
    for (const id of ids) part.set(find(id), find(ids[0]!))
  }
  const out: string[] = []
  for (const root of new Set(cells.filter((c) => unknown(c.id)).map((c) => find(c.id)))) {
    const mine = lines.filter((l) => [l.parent, ...l.children].some((id) => unknown(id) && find(id) === root))
    const ids = new Set(mine.flatMap((l) => [l.parent, ...l.children]))
    const seen = possibleValues(cells.filter((c) => ids.has(c.id)), mine, states, minimum, total, budget)
    if (!seen) return null
    for (const c of cells) {
      if (!ids.has(c.id) || !unknown(c.id) || c.value < 1 || c.value >= minimum) continue
      for (let v = 1; v < minimum && v <= total; v++)
        if (!seen.get(c.id)!.has(v)) {
          out.push(`${c.id} (true ${c.value}) cannot be ${v}`)
          break
        }
    }
  }
  return out
}
