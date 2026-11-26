import type { Payload, Where } from 'payload'

import { suppress, type Cell, type Line, type State } from './suppress.js'
import type { ResolvedBand, ResolvedField, ResolvedStatsOptions, StatsBandReport, StatsCount, StatsFieldReport, StatsReport } from './types.js'

const DAY = 86_400_000

/**
 * Builds the report. Every read of the users collection is a count. The one aggregate (count bands) groups and counts
 * inside the database and returns a single row of totals. No user document, name, email or ID is ever loaded.
 */
export async function buildReport(payload: Payload, opts: ResolvedStatsOptions): Promise<StatsReport> {
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

  const { cells, lines } = layout({ total, new1, new7, new30, fields, bands })
  const states = suppress(cells, lines, opts.minimum)
  const values = new Map(cells.map((c) => [c.id, c.value]))
  const show = (id: string): StatsCount => publish(values.get(id)!, states.get(id)!, opts.minimum)

  return {
    generatedAt: now.toISOString(),
    minimum: opts.minimum,
    totals: { all: show('total'), newYesterday: show('new1'), new7Days: show('new7'), new30Days: show('new30') },
    fields: fields.map((f, i): StatsFieldReport => {
      const base = { path: opts.fields[i]!.path, label: opts.fields[i]!.label, multiple: f.multiple }
      if (f.unavailable) return { ...base, unavailable: f.unavailable, groups: [], values: [] }
      return {
        ...base,
        any: show(`f${i}.any`),
        none: show(`f${i}.none`),
        groups: f.groups.map((g, k) => ({ label: g.label, count: show(`f${i}.g${k}`) })),
        values: f.values.map((v, j) => ({ label: v.label, count: show(`f${i}.v${j}`) })),
      }
    }),
    bands: bands.map((b, i): StatsBandReport => {
      const base = { collection: opts.bands[i]!.collection, field: opts.bands[i]!.field, label: opts.bands[i]!.label }
      if (b.unavailable) return { ...base, unavailable: b.unavailable, rows: [] }
      return { ...base, rows: opts.bands[i]!.thresholds.map((t, j) => ({ moreThan: t, count: show(`b${i}.t${j}`) })) }
    }),
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
 * Turns the raw counts into cells and the lines that tie them together: everything a reader could add or subtract.
 * Cell ids: `total`, `new1`, `new7`, `new30`, `f<i>.any`, `f<i>.none`, `f<i>.v<j>`, `f<i>.g<k>`, `b<i>.t<j>`.
 */
export function layout({ total, new1, new7, new30, fields, bands }: RawCounts): { cells: Cell[]; lines: Line[] } {
  const cells: Cell[] = []
  const lines: Line[] = []
  const cell = (id: string, value: number) => (cells.push({ id, value }), id)
  /** parent = child + a remainder nobody sees a row for, but anyone can subtract. */
  const within = (parent: string, parentValue: number, child: string, childValue: number) => {
    const rest = `${parent}-minus-${child}`
    cells.push({ id: rest, value: Math.max(0, parentValue - childValue), implicit: true })
    lines.push({ kind: 'sum', parent, children: [child, rest] })
  }

  cell('total', total)
  cell('new30', new30)
  cell('new7', new7)
  cell('new1', new1)
  within('total', total, 'new30', new30)
  within('new30', new30, 'new7', new7)
  within('new7', new7, 'new1', new1)

  fields.forEach((f, i) => {
    if (f.unavailable) return
    const any = cell(`f${i}.any`, f.any)
    const none = cell(`f${i}.none`, Math.max(0, total - f.any))
    lines.push({ kind: 'sum', parent: 'total', children: [any, none] })
    const values = f.values.map((v, j) => cell(`f${i}.v${j}`, v.count))
    if (f.multiple) {
      // Rows overlap: each is inside "any", and together they cover it.
      values.forEach((v, j) => within(any, f.any, v, f.values[j]!.count))
      if (values.length) lines.push({ kind: 'cover', parent: any, children: values })
    } else lines.push({ kind: 'sum', parent: any, children: values })
    f.groups.forEach((g, k) => {
      const group = cell(`f${i}.g${k}`, g.count)
      const members = g.members.map((j) => values[j]!)
      within(any, f.any, group, g.count)
      if (f.multiple) {
        g.members.forEach((j) => within(group, g.count, values[j]!, f.values[j]!.count))
        lines.push({ kind: 'cover', parent: group, children: members })
      } else {
        lines.push({ kind: 'sum', parent: group, children: members })
        lines.push({ kind: 'sum', parent: `${any}-minus-${group}`, children: values.filter((v) => !members.includes(v)) })
      }
    })
  })

  bands.forEach((b, i) => {
    if (b.unavailable) return
    const ids = b.counts.map((n, j) => cell(`b${i}.t${j}`, n))
    // A ladder: each rung is inside the one before, and the first is inside the total.
    ids.forEach((id, j) => (j === 0 ? within('total', total, id, b.counts[0]!) : within(ids[j - 1]!, b.counts[j - 1]!, id, b.counts[j]!)))
  })

  return { cells, lines }
}

export function publish(value: number, state: State, minimum: number): StatsCount {
  if (state === 'exact') return { value, text: String(value) }
  if (state === 'small') return { value: null, hidden: 'small', text: `fewer than ${minimum}` }
  // `protected` and `withheld` read the same. Only the engine needs to tell them apart.
  return { value: null, hidden: 'protected', text: 'hidden' }
}


async function countField(payload: Payload, field: ResolvedField, count: (where: Where) => Promise<number>): Promise<FieldCounts> {
  const empty = { multiple: field.multiple, any: 0, values: [], groups: [] }
  let options: { label: string; value: number | string }[] = field.options
  if (field.kind === 'relationship') {
    // The related collection holds categories (positions, teams), never accounts: config.ts refuses auth collections.
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
