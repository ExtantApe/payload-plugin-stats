import type { Cell, Line, State } from '../src/suppress.js'

/**
 * A reader with unlimited patience. Given only what a report publishes (exact numbers, "fewer than" labels, "hidden"
 * labels) and how the report is built (the lines), it tries every whole-number filling of the unknown cells and keeps
 * the ones where all the arithmetic works. Returns, for each cell, every value it could still have.
 *
 * It shares no code with the hiding engine: it enumerates, the engine reasons with ranges.
 * Returns null when there are too many fillings to try within the budget.
 */
export function possibleValues(cells: Cell[], lines: Line[], states: Map<string, State>, minimum: number, cap: number, budget = 2_000_000): Map<string, Set<number>> | null {
  const explicit = cells.filter((c) => !c.implicit)
  const unknown = explicit.filter((c) => states.get(c.id) !== 'exact')
  const order = new Map(unknown.map((c, i) => [c.id, i]))
  const range = (c: Cell): [number, number] => (states.get(c.id) === 'small' ? [0, minimum - 1] : states.get(c.id) === 'withheld' ? [0, cap] : [minimum, cap])

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

/** Sensitive cells the reader can narrow: some value from 1 to minimum - 1 has been ruled out. */
export function narrowed(cells: Cell[], lines: Line[], states: Map<string, State>, minimum: number, cap: number, budget?: number): null | string[] {
  const seen = possibleValues(cells, lines, states, minimum, cap, budget)
  if (!seen) return null
  const out: string[] = []
  for (const c of cells) {
    if (c.value < 1 || c.value >= minimum) continue
    for (let v = 1; v < minimum; v++) if (!seen.get(c.id)!.has(v)) return [...out, `${c.id} (true ${c.value}) cannot be ${v}`]
  }
  return out
}
