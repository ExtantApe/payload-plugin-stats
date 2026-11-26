import type { Payload, Where } from 'payload'

import { suppress, type Block, type Cell, type State } from './suppress.js'
import type { ResolvedBand, ResolvedField, ResolvedStatsOptions, StatsBandReport, StatsCount, StatsFieldReport, StatsReport } from './types.js'

const DAY = 86_400_000

/**
 * Builds the report. Every read of the users collection is a count. The one aggregate (count bands) groups and counts
 * inside the database and returns a single row of totals. No user document, name, email or ID is ever loaded.
 */
export async function buildReport(payload: Payload, opts: ResolvedStatsOptions): Promise<StatsReport> {
  // Fails closed: no count is read until the check against the final config has passed.
  if (opts.final && !opts.final.ok) throw new Error(`stats: turned off. ${opts.final.why}`)
  const users = opts.users as never
  const count = async (where?: Where) => (await payload.count({ collection: users, overrideAccess: true, ...(where ? { where } : {}) })).totalDocs

  const now = opts.now()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // Whole UTC days that have ended: yesterday, the 7 days before today, the 30 days before today.
  const since = (days: number) => count({ and: [{ createdAt: { greater_than_equal: new Date(today - days * DAY).toISOString() } }, { createdAt: { less_than: new Date(today).toISOString() } }] })

  const [total, new1, new7, new30, fields, bands] = await Promise.all([
    count(),
    since(1),
    since(7),
    since(30),
    Promise.all(opts.fields.map((f) => countField(payload, f, count))),
    Promise.all(opts.bands.map((b) => countBand(payload, opts.users, b))),
  ])

  const shown = present({ total, new1, new7, new30, fields, bands }, opts.minimum)

  return {
    generatedAt: now.toISOString(),
    minimum: opts.minimum,
    totals: shown.totals,
    fields: fields.map((f, i): StatsFieldReport => {
      const base = { path: opts.fields[i]!.path, label: opts.fields[i]!.label, multiple: f.multiple }
      const counts = shown.fields[i]
      if (f.unavailable || !counts) return { ...base, unavailable: f.unavailable ?? 'Not counted.', groups: [], values: [] }
      return {
        ...base,
        any: counts.any,
        none: counts.none,
        groups: f.groups.map((g, k) => ({ label: g.label, count: counts.groups[k]! })),
        values: f.values.map((v, j) => ({ label: v.label, count: counts.values[j]! })),
      }
    }),
    bands: bands.map((b, i): StatsBandReport => {
      const base = { collection: opts.bands[i]!.collection, field: opts.bands[i]!.field, label: opts.bands[i]!.label }
      const rows = shown.bands[i]
      if (b.unavailable || !rows) return { ...base, unavailable: b.unavailable ?? 'Not counted.', rows: [] }
      return { ...base, rows: opts.bands[i]!.thresholds.map((t, j) => ({ moreThan: t, count: rows[j]! })) }
    }),
  }
}

/** Every number a report publishes, in the report's own order. A field or band that could not be counted is null. */
export interface Shown {
  totals: StatsReport['totals']
  fields: (null | { any: StatsCount; none: StatsCount; groups: StatsCount[]; values: StatsCount[] })[]
  bands: (null | StatsCount[])[]
}

export type Engine = (cells: Cell[], blocks: Block[], minimum: number) => Map<string, State>

/**
 * From the true counts to what may be shown. Pure: no Payload, no clock. Everything a reader ever sees of the counts
 * comes out of this function, so the tests that play a reader call it and nothing beneath it.
 */
export function present(raw: RawCounts, minimum: number, engine: Engine = suppress): Shown {
  const { cells, blocks } = layout(raw)
  const states = engine(cells, blocks, minimum)
  const values = new Map(cells.map((c) => [c.id, c.value]))
  const show = (id: string): StatsCount => publish(values.get(id)!, states.get(id)!)
  return {
    totals: { all: show('total'), newYesterday: show('new1'), new7Days: show('new7'), new30Days: show('new30') },
    fields: raw.fields.map((f, i) =>
      f.unavailable ? null : { any: show(`f${i}.any`), none: show(`f${i}.none`), groups: f.groups.map((_, k) => show(`f${i}.g${k}`)), values: f.values.map((_, j) => show(`f${i}.v${j}`)) },
    ),
    bands: raw.bands.map((b, i) => (b.unavailable ? null : b.counts.map((_, j) => show(`b${i}.t${j}`)))),
  }
}

export interface FieldCounts {
  multiple: boolean
  unavailable?: string
  any: number
  values: { label: string; count: number }[]
  /** `members` are indexes into `values`. */
  groups: { label: string; count: number; members: number[] }[]
}

export interface BandCounts {
  unavailable?: string
  /** Users over each threshold, lowest threshold first. */
  counts: number[]
}

export interface RawCounts {
  total: number
  new1: number
  new7: number
  new30: number
  fields: FieldCounts[]
  bands: BandCounts[]
}

/**
 * Turns the raw counts into cells and the blocks they are hidden by.
 * Cell ids: `total`, `new1`, `new7`, `new30`, `f<i>.any`, `f<i>.none`, `f<i>.v<j>`, `f<i>.g<k>`, `b<i>.t<j>`.
 *
 * The blocks depend only on the shape of the report (which fields, roll-ups and thresholds are configured), never on
 * a count:
 * - the total has no block and always shows;
 * - each step of a ladder (new-account windows, count bands) is a block holding the step's count and the remainder
 *   above it, nested under the step before, so a ladder shows from the top down to the first small count and is
 *   hidden from there on;
 * - each field has a block for "any" and "none", and nested under it one block for every row and roll-up.
 */
export function layout({ total, new1, new7, new30, fields, bands }: RawCounts): { blocks: Block[]; cells: Cell[] } {
  const cells: Cell[] = []
  const blocks: Block[] = []
  const cell = (id: string, value: number, block?: string) => (cells.push({ id, value, ...(block ? { block } : {}) }), id)
  /** parent = child + a remainder nobody sees a row for, but anyone can subtract. Negative when the counts disagree. */
  const within = (parent: string, parentValue: number, child: string, childValue: number, block: string) => {
    cells.push({ id: `${parent}-minus-${child}`, value: parentValue - childValue, implicit: true, block })
  }
  /** Each rung is inside the one before, and the first is inside the total. */
  const ladder = (ids: string[], values: number[]) =>
    ids.forEach((id, j) => {
      blocks.push({ id, ...(j ? { parent: ids[j - 1]! } : {}) })
      cell(id, values[j]!, id)
      within(j ? ids[j - 1]! : 'total', j ? values[j - 1]! : total, id, values[j]!, id)
    })

  cell('total', total)
  ladder(['new30', 'new7', 'new1'], [new30, new7, new1])

  fields.forEach((f, i) => {
    if (f.unavailable) return
    const top = `f${i}.top`
    const rows = `f${i}.rows`
    const any = cell(`f${i}.any`, f.any, top)
    cell(`f${i}.none`, total - f.any, top)
    const values = f.values.map((v, j) => cell(`f${i}.v${j}`, v.count, rows))
    const sum = (ids: number[]) => ids.reduce((s, j) => s + f.values[j]!.count, 0)
    // Overlapping rows must cover their parent, and rows that do not overlap must add up to it.
    let broken = f.multiple ? sum(f.values.map((_, j) => j)) < f.any : sum(f.values.map((_, j) => j)) !== f.any
    // Rows overlap: each is inside "any", so the users with some value who lack this one can be subtracted out.
    if (f.multiple) values.forEach((v, j) => within(any, f.any, v, f.values[j]!.count, rows))
    f.groups.forEach((g, k) => {
      const group = cell(`f${i}.g${k}`, g.count, rows)
      within(any, f.any, group, g.count, rows)
      if (f.multiple) {
        g.members.forEach((j) => within(group, g.count, values[j]!, f.values[j]!.count, rows))
        if (sum(g.members) < g.count) broken = true
      } else if (sum(g.members) !== g.count) broken = true
    })
    blocks.push({ id: top }, { id: rows, parent: top, ...(broken ? { broken } : {}) })
  })

  bands.forEach((b, i) => {
    if (b.unavailable) return
    ladder(b.counts.map((_, j) => `b${i}.t${j}`), b.counts)
  })

  return { blocks, cells }
}

/** A zero in a table that shows is shown as 0: wording it "fewer than" could only ever have meant 0. */
export function publish(value: number, state: State): StatsCount {
  if (state === 'exact') return { value, text: String(value) }
  return { value: null, hidden: 'protected', text: 'hidden' }
}

async function countField(payload: Payload, field: ResolvedField, count: (where: Where) => Promise<number>): Promise<FieldCounts> {
  const empty = { multiple: field.multiple, any: 0, values: [], groups: [] }
  let options: { label: string; value: number | string }[] = field.options
  if (field.kind === 'relationship') {
    // The related collection holds categories (positions, teams): config.ts takes only collections the site listed
    // under `categories`, and never an auth collection.
    const { docs } = await payload.find({ collection: field.relationTo as never, depth: 0, limit: field.maxValues + 1, overrideAccess: true, pagination: false })
    if (docs.length > field.maxValues) return { ...empty, unavailable: `More than ${field.maxValues} values; not broken down.` }
    options = (docs as unknown as Record<string, unknown>[])
      .map((d, i) => {
        const title = field.titleField ? d[field.titleField] : undefined
        return { label: typeof title === 'string' && title ? title : `Untitled ${i + 1}`, value: d.id as number | string }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  if (!options.length) return empty
  const holding = (values: (number | string)[]) => count({ [field.path]: { in: values } })
  const [values, groups, anyCounted] = await Promise.all([
    Promise.all(options.map(async (o) => ({ label: o.label, count: await count({ [field.path]: { equals: o.value } }) }))),
    Promise.all(field.groups.map(async (g) => ({ label: g.label, count: field.multiple ? await holding(g.values) : -1, members: g.values.map((v) => options.findIndex((o) => o.value === v)) }))),
    field.multiple ? holding(options.map((o) => o.value)) : Promise.resolve(-1),
  ])
  // One value per user: the rows add up, so the high-level numbers are sums, and always agree with the rows.
  if (!field.multiple) for (const g of groups) g.count = g.members.reduce((s, j) => s + values[j]!.count, 0)
  const any = field.multiple ? anyCounted : values.reduce((s, v) => s + v.count, 0)
  return { multiple: field.multiple, any, values, groups }
}


type Model = { aggregate: (pipeline: unknown[]) => Promise<Record<string, number>[]>; collection: { name: string } }

async function countBand(payload: Payload, users: string, band: ResolvedBand): Promise<BandCounts> {
  const models = (payload.db as unknown as { collections?: Record<string, Model> }).collections
  const docs = models?.[band.collection]
  const accounts = models?.[users]
  if (payload.db.name !== 'mongoose' || typeof docs?.aggregate !== 'function' || !accounts?.collection?.name)
    return { unavailable: 'Count bands need the MongoDB adapter.', counts: [] }
  const ref = `$${band.field}`
  const [row] = await docs.aggregate([
    { $match: { [band.field]: { $ne: null } } },
    ...(band.hasMany ? [{ $unwind: ref }, { $group: { _id: { doc: '$_id', user: ref } } }, { $group: { _id: '$_id.user', n: { $sum: 1 } } }] : [{ $group: { _id: ref, n: { $sum: 1 } } }]),
    // Count only documents whose user still exists. Nothing but the _id is read, and it never leaves the pipeline.
    { $lookup: { from: accounts.collection.name, localField: '_id', foreignField: '_id', as: 'account', pipeline: [{ $project: { _id: 1 } }] } },
    { $match: { 'account.0': { $exists: true } } },
    { $group: { _id: null, ...Object.fromEntries(band.thresholds.map((t, i) => [`t${i}`, { $sum: { $cond: [{ $gt: ['$n', t] }, 1, 0] } }])) } },
  ])
  return { counts: band.thresholds.map((_, i) => row?.[`t${i}`] ?? 0) }
}
