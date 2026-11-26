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

/** A field with its own read rule hides its values from some readers. A count over it would show them anyway. */
function refuseOwnReadAccess(field: Field, what: string, path: string, part: string): void {
  const access = (field as { access?: { read?: unknown } }).access
  if (access && access.read !== undefined && access.read !== null)
    throw new Error(`stats: ${what} "${path}": "${part}" has its own read access. A count would show what that rule hides, so it is refused.`)
}

/**
 * Walks a dot path to its field. Says whether an array or hasMany on the way lets one user hold several values.
 * Refuses the field, and every field on the way to it, when it has its own read access.
 */
function walk(collection: CollectionConfig, path: string, what: string): { field: Field; inArray: boolean; multiple: boolean } {
  let fields = named(collection.fields)
  let multiple = false
  const parts = path.split('.')
  for (const [i, part] of parts.entries()) {
    const field = fields.find((f) => 'name' in f && f.name === part)
    if (!field) throw new Error(`stats: ${what} "${path}": no field "${part}" on "${collection.slug}".`)
    if ('localized' in field && field.localized) throw new Error(`stats: ${what} "${path}": localized fields are not supported.`)
    refuseOwnReadAccess(field, what, path, part)
    if (i === parts.length - 1) return { field, inArray: multiple, multiple: multiple || ('hasMany' in field && field.hasMany === true) }
    if (field.type === 'array') multiple = true
    else if (field.type !== 'group') throw new Error(`stats: ${what} "${path}": "${part}" must be a group or an array.`)
    fields = named((field as { fields: Field[] }).fields)
  }
  throw new Error(`stats: ${what} "${path}" is empty.`)
}

function resolveField(config: Config, users: CollectionConfig, categories: string[], raw: StatsFieldOption | string): ResolvedField {
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
    // Any other collection could hold one document per person too (profiles titled by full name). Only the site
    // knows, so it has to say so.
    if (!categories.includes(related.slug))
      throw new Error(`stats: field "${option.path}" points at "${related.slug}". Its titles would show as row labels, so list "${related.slug}" in the categories option if they are categories and never people.`)
    if (base.groups.length) throw new Error(`stats: field "${option.path}": groups are for select and radio fields.`)
    // The title is read past access control, so a title field with its own read rule is refused. An ID is never a label.
    const useAsTitle = related.admin?.useAsTitle
    const titleField = useAsTitle && useAsTitle !== 'id' ? useAsTitle : undefined
    const title = titleField ? named(related.fields).find((f) => 'name' in f && f.name === titleField) : undefined
    if (title) refuseOwnReadAccess(title, 'field', option.path, `${related.slug}.${titleField}`)
    return { ...base, kind: 'relationship', options: [], relationTo: related.slug, titleField }
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
export function resolveOptions(config: Config, options: StatsOptions): ResolvedStatsOptions {
  // No default and no guessing: Payload's own `access.admin` only says who may open the admin panel, and editors
  // often can. The site has to name who sees the stats.
  if (typeof (options as StatsOptions | undefined)?.access !== 'function')
    throw new Error('stats: the access option is required and must be a function, such as ({ req }) => req.user?.role === "admin". There is no default.')
  const access = options.access
  const slug = options.users ?? 'users'
  const users = (config.collections ?? []).find((c) => c.slug === slug)
  if (!users?.auth) throw new Error(`stats: no auth collection "${slug}".`)
  if (users.timestamps === false) throw new Error(`stats: "${slug}" needs timestamps, for the new-account counts.`)
  const minimum = options.minimum ?? 5
  if (!Number.isInteger(minimum) || minimum < 2) throw new Error('stats: minimum must be a whole number, 2 or more.')
  const path = options.path ?? '/stats'
  if (!/^\/[\w-]+(\/[\w-]+)*$/.test(path)) throw new Error('stats: path must look like "/stats".')

  const categories = options.categories ?? []
  if (!Array.isArray(categories) || categories.some((c) => typeof c !== 'string')) throw new Error('stats: categories must be a list of collection slugs.')
  for (const c of categories) {
    const found = (config.collections ?? []).find((k) => k.slug === c)
    if (!found) throw new Error(`stats: categories: no collection "${c}".`)
    if (found.auth) throw new Error(`stats: categories: "${c}" is an auth collection. Its documents are people, never categories.`)
  }

  const fields = (options.fields ?? []).map((f) => resolveField(config, users, categories, f))
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
