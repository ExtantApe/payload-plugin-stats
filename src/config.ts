import type { CollectionConfig, Config, Field } from 'payload'

import type { ResolvedBand, ResolvedField, ResolvedStatsOptions, StatsFieldOption, StatsOptions } from './types.js'

const text = (label: unknown, fallback: string): string => {
  if (typeof label === 'string' && label) return label
  if (label && typeof label === 'object') {
    const first = (label as Record<string, unknown>).en ?? Object.values(label as Record<string, unknown>)[0]
    if (typeof first === 'string' && first) return first
  }
  return fallback
}

/** Fields as a query path sees them: rows, collapsibles and unnamed tabs are see-through. */
function named(fields: Field[]): Field[] {
  return fields.flatMap((f): Field[] => {
    if (f.type === 'row' || f.type === 'collapsible') return named(f.fields)
    if (f.type === 'tabs') return f.tabs.flatMap((t) => ('name' in t && t.name ? [{ ...t, type: 'group' } as unknown as Field] : named(t.fields)))
    if (f.type === 'group' && !('name' in f && f.name)) return named(f.fields)
    return [f]
  })
}

/** Walks a dot path to its field. Says whether an array or hasMany on the way lets one user hold several values. */
function walk(collection: CollectionConfig, path: string, what: string): { field: Field; inArray: boolean; multiple: boolean } {
  let fields = named(collection.fields)
  let multiple = false
  const parts = path.split('.')
  for (const [i, part] of parts.entries()) {
    const field = fields.find((f) => 'name' in f && f.name === part)
    if (!field) throw new Error(`stats: ${what} "${path}": no field "${part}" on "${collection.slug}".`)
    if ('localized' in field && field.localized) throw new Error(`stats: ${what} "${path}": localized fields are not supported.`)
    if (i === parts.length - 1) return { field, inArray: multiple, multiple: multiple || ('hasMany' in field && field.hasMany === true) }
    if (field.type === 'array') multiple = true
    else if (field.type !== 'group') throw new Error(`stats: ${what} "${path}": "${part}" must be a group or an array.`)
    fields = named((field as { fields: Field[] }).fields)
  }
  throw new Error(`stats: ${what} "${path}" is empty.`)
}

function resolveField(config: Config, users: CollectionConfig, raw: StatsFieldOption | string): ResolvedField {
  const option = typeof raw === 'string' ? { path: raw } : raw
  const { field, multiple } = walk(users, option.path, 'field')
  const label = option.label ?? text('label' in field ? field.label : undefined, option.path)
  const base = { path: option.path, label, multiple, groups: option.groups ?? [], maxValues: option.maxValues ?? 50 }
  if (field.type === 'select' || field.type === 'radio') {
    const options = field.options.map((o) => (typeof o === 'string' ? { label: o, value: o } : { label: text(o.label, o.value), value: o.value }))
    for (const g of base.groups)
      for (const v of g.values) if (!options.some((o) => o.value === v)) throw new Error(`stats: field "${option.path}": group "${g.label}" names "${v}", which is not an option.`)
    return { ...base, kind: 'options', options }
  }
  if (field.type === 'relationship') {
    if (typeof field.relationTo !== 'string') throw new Error(`stats: field "${option.path}": relationships to several collections are not supported.`)
    const related = (config.collections ?? []).find((c) => c.slug === field.relationTo)
    if (!related) throw new Error(`stats: field "${option.path}": no collection "${field.relationTo}".`)
    // A breakdown by related document shows that document's title. Titles of accounts are names, so refuse.
    if (related.auth) throw new Error(`stats: field "${option.path}" points at "${related.slug}", an auth collection. Counting by person is refused.`)
    if (base.groups.length) throw new Error(`stats: field "${option.path}": groups are for select and radio fields.`)
    return { ...base, kind: 'relationship', options: [], relationTo: related.slug, titleField: related.admin?.useAsTitle }
  }
  throw new Error(`stats: field "${option.path}" is a ${field.type} field; use a select, radio or relationship field.`)
}

function resolveBand(config: Config, users: string, raw: NonNullable<StatsOptions['bands']>[number]): ResolvedBand {
  const collection = (config.collections ?? []).find((c) => c.slug === raw.collection)
  if (!collection) throw new Error(`stats: band: no collection "${raw.collection}".`)
  const { field, inArray } = walk(collection, raw.field, 'band field')
  if (field.type !== 'relationship' || field.relationTo !== users) throw new Error(`stats: band field "${raw.collection}.${raw.field}" must be a relationship to "${users}" only.`)
  const hasMany = field.hasMany === true
  if (inArray) throw new Error(`stats: band field "${raw.collection}.${raw.field}" sits inside an array, which is not supported.`)
  const thresholds = [...new Set(raw.thresholds ?? [1, 5, 10, 25, 50])].sort((a, b) => a - b)
  if (!thresholds.length || thresholds.some((t) => !Number.isInteger(t) || t < 0)) throw new Error(`stats: band "${raw.collection}.${raw.field}": thresholds must be whole numbers, 0 or more.`)
  return { collection: raw.collection, field: raw.field, hasMany, thresholds, label: raw.label ?? `${text(collection.labels?.plural, raw.collection)} per user` }
}

/** Checks the options against the config at start-up, so a mistake stops the boot and never shows a wrong number. */
export function resolveOptions(config: Config, options: StatsOptions = {}): ResolvedStatsOptions {
  const slug = options.users ?? 'users'
  const users = (config.collections ?? []).find((c) => c.slug === slug)
  if (!users?.auth) throw new Error(`stats: no auth collection "${slug}".`)
  if (users.timestamps === false) throw new Error(`stats: "${slug}" needs timestamps, for the new-account counts.`)
  const minimum = options.minimum ?? 5
  if (!Number.isInteger(minimum) || minimum < 2) throw new Error('stats: minimum must be a whole number, 2 or more.')
  const path = options.path ?? '/stats'
  if (!/^\/[\w-]+(\/[\w-]+)*$/.test(path)) throw new Error('stats: path must look like "/stats".')

  const adminCheck = users.access?.admin
  if (!options.access && !adminCheck)
    throw new Error(`stats: set the access option, or give "${slug}" an access.admin check. Without one, any signed-in user would count as an admin.`)
  const access =
    options.access ??
    (async ({ req }) => (req.user as { collection?: string } | null)?.collection === slug && (await adminCheck!({ req })) === true)

  const fields = (options.fields ?? []).map((f) => resolveField(config, users, f))
  const paths = fields.map((f) => f.path)
  if (new Set(paths).size !== paths.length) throw new Error('stats: a field path is listed twice.')
  return {
    users: slug,
    access,
    minimum,
    fields,
    bands: (options.bands ?? []).map((b) => resolveBand(config, slug, b)),
    path: path as `/${string}`,
    admin: { card: options.admin?.card !== false, view: options.admin?.view !== false },
    now: options.now ?? (() => new Date()),
  }
}

export const CUSTOM_KEY = 'payloadPluginStats'

export function optionsOf(config: { custom?: Record<string, unknown> }): ResolvedStatsOptions {
  const found = config.custom?.[CUSTOM_KEY] as ResolvedStatsOptions | undefined
  if (!found) throw new Error('stats: the plugin is not installed in this config.')
  return found
}
