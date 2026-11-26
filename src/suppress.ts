/**
 * Small-group hiding. Pure functions, no Payload.
 *
 * A report is a set of cells (counts) tied together by lines. A `sum` line says a parent count is exactly the sum of
 * its children; a `cover` line says a parent is at most the sum of its children (overlapping groups). Some cells are
 * implicit: the report has no row for them, but a reader can reach them by subtraction, such as "accounts made 2 to 7
 * days ago" or "users without this role".
 *
 * A cell is sensitive when its true count is from 1 to minimum - 1. The promise: from the published numbers, a reader
 * who adds and subtracts along the lines cannot rule out any value from 1 to minimum - 1 for a sensitive cell. To keep
 * it, larger counts are hidden too (complementary suppression) until every sensitive cell is safe.
 */

export interface Cell {
  id: string
  /** The true count. Never leaves the server unless the cell ends up published as exact. */
  value: number
  /** No row in the report; reachable only by subtraction. */
  implicit?: boolean
}

export interface Line {
  kind: 'cover' | 'sum'
  parent: string
  children: string[]
}

/**
 * `exact`: shown. `small`: under the minimum (zero included), shown as "fewer than". `protected`: at or over the
 * minimum, hidden so a small count can't be worked out. `withheld`: hidden with no hint of size; used for every cell
 * when there are too few users for the labels themselves to be safe.
 */
export type State = 'exact' | 'protected' | 'small' | 'withheld'

type Range = [number, number]
const INF = Number.POSITIVE_INFINITY

/** What a reader knows about each cell before any arithmetic. */
function known(cell: Cell, state: State | 'implicit', minimum: number): Range {
  if (state === 'exact') return [cell.value, cell.value]
  if (state === 'small') return [0, minimum - 1]
  if (state === 'protected') return [minimum, INF] // the label differs from "fewer than", so a reader knows this much
  return [0, INF]
}

/** Tightens every range along every line until nothing moves: what a reader can work out by adding and subtracting. */
export function propagate(ranges: Map<string, Range>, lines: Line[]): void {
  for (let pass = 0; pass < 500; pass++) {
    let moved = false
    const tighten = (id: string, lo: number, hi: number) => {
      const r = ranges.get(id)!
      if (lo > r[0]) (r[0] = lo), (moved = true)
      if (hi < r[1]) (r[1] = hi), (moved = true)
    }
    for (const line of lines) {
      const kids = line.children.map((c) => ranges.get(c)!)
      const parent = ranges.get(line.parent)!
      const lows = kids.reduce((s, r) => s + r[0], 0)
      const highs = kids.reduce((s, r) => s + r[1], 0)
      tighten(line.parent, line.kind === 'sum' ? lows : -INF, highs)
      line.children.forEach((id, i) => {
        const others = kids.filter((_, j) => j !== i)
        const lo = parent[0] - others.reduce((s, r) => s + r[1], 0)
        const hi = line.kind === 'sum' ? parent[1] - others.reduce((s, r) => s + r[0], 0) : INF
        tighten(id, Number.isNaN(lo) ? -INF : lo, hi)
      })
    }
    if (!moved) return
  }
}

/**
 * Decides what each explicit cell may show. Returns a state per explicit cell id.
 * If the numbers don't add up (the data changed between two counts), it keeps hiding until nothing exact is left near
 * the trouble, so it fails closed.
 */
export function suppress(cells: Cell[], lines: Line[], minimum: number): Map<string, State> {
  const byId = new Map(cells.map((c) => [c.id, c]))
  for (const line of lines) for (const id of [line.parent, ...line.children]) if (!byId.has(id)) throw new Error(`stats: line names an unknown cell "${id}".`)
  const state = new Map<string, State | 'implicit'>(cells.map((c) => [c.id, c.implicit ? 'implicit' : c.value < minimum ? 'small' : 'exact']))
  const sensitive = cells.filter((c) => c.value >= 1 && c.value < minimum)

  for (;;) {
    const ranges = new Map(cells.map((c) => [c.id, known(c, state.get(c.id)!, minimum)] as [string, Range]))
    propagate(ranges, lines)
    const exposed = sensitive.find((c) => {
      const [lo, hi] = ranges.get(c.id)!
      return lo > 1 || hi < minimum - 1
    })
    if (!exposed) break
    const pick = nearestExact(exposed.id, lines, state, byId)
    if (!pick) {
      // Nothing exact is left to hide, and "fewer than" next to "hidden" still narrows a small count. This happens
      // only with very few users. Say nothing about any size.
      return new Map(cells.filter((c) => !c.implicit).map((c) => [c.id, 'withheld' as State]))
    }
    state.set(pick, 'protected')
  }

  const out = new Map<string, State>()
  for (const c of cells) if (!c.implicit) out.set(c.id, state.get(c.id) as State)
  return out
}

/** The exact cell to hide next: the closest one along the lines, a sibling row before a parent, the smallest first. */
function nearestExact(from: string, lines: Line[], state: Map<string, State | 'implicit'>, byId: Map<string, Cell>): null | string {
  const seen = new Set([from])
  let frontier = [from]
  while (frontier.length) {
    const found: { id: string; parent: boolean }[] = []
    const next: string[] = []
    for (const line of lines) {
      const members = [line.parent, ...line.children]
      if (!members.some((m) => frontier.includes(m))) continue
      for (const m of members) {
        if (state.get(m) === 'exact') found.push({ id: m, parent: m === line.parent })
        if (!seen.has(m)) seen.add(m), next.push(m)
      }
    }
    if (found.length) {
      found.sort((a, b) => Number(a.parent) - Number(b.parent) || byId.get(a.id)!.value - byId.get(b.id)!.value || a.id.localeCompare(b.id))
      return found[0]!.id
    }
    frontier = next
  }
  return null
}
