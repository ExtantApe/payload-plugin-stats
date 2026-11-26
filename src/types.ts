import type { PayloadRequest } from 'payload'

export interface StatsFieldOption {
  /** Dot path to a select, radio or relationship field on the users collection, such as `roles` or `tenants.roles`. */
  path: string
  /** Heading for this field. Default: the field's own label, or its path. */
  label?: string
  /** High-level roll-ups for select and radio fields: users holding any of the listed values. */
  groups?: { label: string; values: string[] }[]
  /** For relationship fields: refuse to break down by more related documents than this. Default 50. */
  maxValues?: number
}

export interface StatsBandOption {
  /** The collection whose documents are counted per user, such as `posts`. */
  collection: string
  /** A relationship field on that collection that points at the users collection, such as `owner`. */
  field: string
  /** Rows are "users with more than N documents". Default [1, 5, 10, 25, 50]. Use 0 for "at least one". */
  thresholds?: number[]
  label?: string
}

export type StatsAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export interface StatsOptions {
  /** The auth collection to count. Default `users`. */
  users?: string
  /** Who may see the stats. Only an exact `true` allows. Default: the users collection's own `access.admin`. */
  access?: StatsAccess
  /** Counts under this are never shown. Default 5; at least 2. */
  minimum?: number
  fields?: (StatsFieldOption | string)[]
  bands?: StatsBandOption[]
  /** Path of the JSON endpoint (under the API route) and of the admin view (under the admin route). Default `/stats`. */
  path?: `/${string}`
  /** Set either to false to leave it out of the admin. Both default to true. */
  admin?: { card?: boolean; view?: boolean }
  /** The clock, for tests. */
  now?: () => Date
}

export interface ResolvedField {
  path: string
  label: string
  /** A user can hold several values (hasMany, or the field sits inside an array), so rows overlap. */
  multiple: boolean
  kind: 'options' | 'relationship'
  options: { label: string; value: string }[]
  relationTo?: string
  titleField?: string
  groups: { label: string; values: string[] }[]
  maxValues: number
}

export interface ResolvedBand {
  collection: string
  field: string
  hasMany: boolean
  thresholds: number[]
  label: string
}

export interface ResolvedStatsOptions {
  users: string
  access: StatsAccess
  minimum: number
  fields: ResolvedField[]
  bands: ResolvedBand[]
  path: `/${string}`
  admin: { card: boolean; view: boolean }
  now: () => Date
}

/** One number in a report. `value` is null when hidden; `text` is always safe to show. */
export interface StatsCount {
  value: null | number
  /** `small`: under the minimum. `protected`: hidden so a small count can't be worked out by subtraction. */
  hidden?: 'protected' | 'small'
  text: string
}

export interface StatsFieldReport {
  path: string
  label: string
  multiple: boolean
  /** Set when the breakdown could not be made; the other lists are then empty. */
  unavailable?: string
  /** High level: users with any of the values, and users with none of them. */
  any?: StatsCount
  none?: StatsCount
  groups: { label: string; count: StatsCount }[]
  values: { label: string; count: StatsCount }[]
}

export interface StatsBandReport {
  collection: string
  field: string
  label: string
  unavailable?: string
  rows: { moreThan: number; count: StatsCount }[]
}

export interface StatsReport {
  generatedAt: string
  minimum: number
  totals: { all: StatsCount; newYesterday: StatsCount; new7Days: StatsCount; new30Days: StatsCount }
  fields: StatsFieldReport[]
  bands: StatsBandReport[]
}
