/**
 * Small-group hiding. Pure functions, no Payload.
 *
 * A report is a set of cells (counts). Some cells are implicit: the report has no row for them, but a reader can reach
 * them by subtraction, such as "accounts made 2 to 7 days ago" or "users without this role". A cell is sensitive when
 * its true count is from 1 to minimum - 1.
 *
 * What gets hidden is chosen by structure, never by which numbers are large or small. Cells belong to blocks, laid out
 * before any count is read. A block with a sensitive cell is hidden whole: every cell in it reads "hidden", with no
 * hint of size, and so does every block nested under it. The engine never picks one row to hide over another, so the
 * pattern of hidden cells says only "some count in this block is small". The code is public, and the rule is built so
 * that knowing it does not help.
 *
 * A cell with no block is always shown. Only the total has none: it is public (an admin can read it off the users
 * list), and every other number is hidden against a reader who knows it.
 */

export interface Cell {
  id: string
  /** The true count. Never leaves the server unless the cell ends up published as exact. */
  value: number
  /** No row in the report; reachable only by subtraction. */
  implicit?: boolean
  /** The block this cell is hidden with. Leave it out only for the public total. */
  block?: string
}

export interface Block {
  id: string
  /** This block shows only if its parent block shows too. */
  parent?: string
  /** The counts in this block disagree (the data changed between two counts). It is hidden. */
  broken?: boolean
}

/**
 * `exact`: shown, a zero included (a zero is nobody). `hidden`: in a hidden block; nothing is said about its size.
 */
export type State = 'exact' | 'hidden'

/** Decides what each explicit cell may show. Returns a state per explicit cell id. */
export function suppress(cells: Cell[], blocks: Block[], minimum: number): Map<string, State> {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  // A block is clean when every count in it is zero or at least the minimum. A negative count means the numbers
  // disagree, and that hides the block too, so the engine fails closed.
  const clean = new Map(blocks.map((b) => [b.id, !b.broken]))
  for (const c of cells) {
    if (c.block === undefined) continue
    if (!byId.has(c.block)) throw new Error(`stats: cell "${c.id}" names an unknown block "${c.block}".`)
    if (c.value !== 0 && !(c.value >= minimum)) clean.set(c.block, false)
  }
  const open = new Map<string, boolean>()
  const shows = (id: string, seen: string[] = []): boolean => {
    const known = open.get(id)
    if (known !== undefined) return known
    const block = byId.get(id)
    if (!block) throw new Error(`stats: unknown block "${id}".`)
    if (seen.includes(id)) throw new Error(`stats: block "${id}" is nested inside itself.`)
    const answer = clean.get(id)! && (block.parent === undefined || shows(block.parent, [...seen, id]))
    open.set(id, answer)
    return answer
  }

  const out = new Map<string, State>()
  for (const c of cells) {
    if (c.implicit) continue
    if (c.block === undefined) out.set(c.id, 'exact')
    else out.set(c.id, shows(c.block) ? 'exact' : 'hidden')
  }
  return out
}
