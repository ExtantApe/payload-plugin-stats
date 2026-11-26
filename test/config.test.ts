import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../src/config.js'
import { stats } from '../src/index.js'

const isAdmin = ({ req }: { req: { user?: unknown } }) => (req.user as { roles?: string[] } | null)?.roles?.includes('admin') === true

const users = (extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
  slug: 'users',
  auth: true,
  access: { admin: isAdmin },
  fields: [
    { name: 'roles', type: 'select', hasMany: true, options: ['admin', { label: 'Member', value: 'member' }] },
    { name: 'kind', type: 'radio', options: ['individual', 'organization'] },
    { name: 'bio', type: 'text' },
    { name: 'motto', type: 'select', options: ['a'], localized: true },
    { name: 'position', type: 'relationship', relationTo: 'positions' },
    { name: 'buddy', type: 'relationship', relationTo: 'users' },
    { name: 'thing', type: 'relationship', relationTo: ['positions', 'posts'] },
    { name: 'tenants', type: 'array', fields: [{ type: 'row', fields: [{ name: 'roles', type: 'select', options: ['owner', 'viewer'] }] }] },
    { type: 'tabs', tabs: [{ label: 'More', fields: [{ name: 'profile', type: 'group', fields: [{ name: 'level', type: 'select', options: ['one', 'two'] }] }] }] },
  ],
  ...extra,
})
const config = (u = users()): Config =>
  ({
    collections: [
      u,
      { slug: 'positions', admin: { useAsTitle: 'title' }, fields: [{ name: 'title', type: 'text' }] },
      {
        slug: 'posts',
        fields: [
          { name: 'owner', type: 'relationship', relationTo: 'users' },
          { name: 'carers', type: 'relationship', relationTo: 'users', hasMany: true },
          { name: 'home', type: 'relationship', relationTo: 'positions' },
          { name: 'visits', type: 'array', fields: [{ name: 'by', type: 'relationship', relationTo: 'users' }] },
        ],
      },
    ],
  }) as Config

describe('options', () => {
  it('fills in the defaults', () => {
    const o = resolveOptions(config())
    expect(o).toMatchObject({ users: 'users', minimum: 5, path: '/stats', admin: { card: true, view: true }, fields: [], bands: [] })
  })

  it('finds fields by path, through arrays, rows, tabs and groups, and knows which ones overlap', () => {
    const o = resolveOptions(config(), { fields: ['roles', 'kind', 'tenants.roles', 'profile.level', { path: 'position', label: 'Jobs' }] })
    expect(o.fields.map((f) => [f.path, f.kind, f.multiple, f.label])).toEqual([
      ['roles', 'options', true, 'roles'],
      ['kind', 'options', false, 'kind'],
      ['tenants.roles', 'options', true, 'tenants.roles'],
      ['profile.level', 'options', false, 'profile.level'],
      ['position', 'relationship', false, 'Jobs'],
    ])
    expect(o.fields[0]!.options).toEqual([{ label: 'admin', value: 'admin' }, { label: 'Member', value: 'member' }])
    expect(o.fields[4]).toMatchObject({ relationTo: 'positions', titleField: 'title', maxValues: 50 })
  })

  it('sorts and de-duplicates band thresholds and has a default set', () => {
    const o = resolveOptions(config(), { bands: [{ collection: 'posts', field: 'owner' }, { collection: 'posts', field: 'carers', thresholds: [10, 0, 10, 3] }] })
    expect(o.bands.map((b) => [b.field, b.hasMany, b.thresholds])).toEqual([['owner', false, [1, 5, 10, 25, 50]], ['carers', true, [0, 3, 10]]])
  })

  const refusals: [string, () => unknown, RegExp][] = [
    ['a users collection that is missing', () => resolveOptions(config(), { users: 'people' }), /no auth collection "people"/],
    ['a users collection without sign-in', () => resolveOptions(config(), { users: 'positions' }), /no auth collection/],
    ['no access check at all', () => resolveOptions(config(users({ access: {} }))), /set the access option/],
    ['users without timestamps', () => resolveOptions(config(users({ timestamps: false }))), /timestamps/],
    ['a minimum of 1, which would hide nothing', () => resolveOptions(config(), { minimum: 1 }), /2 or more/],
    ['a minimum that is not whole', () => resolveOptions(config(), { minimum: 2.5 }), /2 or more/],
    ['a path that could escape', () => resolveOptions(config(), { path: '/stats/../users' as never }), /path/],
    ['a field that does not exist', () => resolveOptions(config(), { fields: ['nope'] }), /no field "nope"/],
    ['a free-text field', () => resolveOptions(config(), { fields: ['bio'] }), /text field/],
    ['a localized field', () => resolveOptions(config(), { fields: ['motto'] }), /localized/],
    ['a relationship to accounts, which would count by person', () => resolveOptions(config(), { fields: ['buddy'] }), /Counting by person is refused/],
    ['a relationship to several collections', () => resolveOptions(config(), { fields: ['thing'] }), /several collections/],
    ['a path through a plain field', () => resolveOptions(config(), { fields: ['kind.x'] }), /must be a group or an array/],
    ['a roll-up naming an unknown value', () => resolveOptions(config(), { fields: [{ path: 'roles', groups: [{ label: 'Staff', values: ['boss'] }] }] }), /not an option/],
    ['a roll-up on a relationship', () => resolveOptions(config(), { fields: [{ path: 'position', groups: [{ label: 'x', values: [] }] }] }), /groups are for select/],
    ['the same field twice', () => resolveOptions(config(), { fields: ['roles', { path: 'roles' }] }), /twice/],
    ['a band on a missing collection', () => resolveOptions(config(), { bands: [{ collection: 'zoo', field: 'owner' }] }), /no collection "zoo"/],
    ['a band field that points elsewhere', () => resolveOptions(config(), { bands: [{ collection: 'posts', field: 'home' }] }), /relationship to "users" only/],
    ['a band field inside an array', () => resolveOptions(config(), { bands: [{ collection: 'posts', field: 'visits.by' }] }), /inside an array/],
    ['a negative band threshold', () => resolveOptions(config(), { bands: [{ collection: 'posts', field: 'owner', thresholds: [-1] }] }), /whole numbers/],
    ['an endpoint already at the path', () => stats()({ ...config(), endpoints: [{ path: '/stats', method: 'get', handler: () => new Response() }] }), /already exists/],
  ]
  it.each(refusals)('refuses %s at start-up', (_name, run, message) => {
    expect(run).toThrow(message)
  })

  it('adds one GET endpoint, the card and the view, and keeps what was there', () => {
    const before = { ...config(), admin: { components: { beforeDashboard: ['x#Y'], views: { other: { Component: 'a#B', path: '/other' as const } } } } }
    const after = stats({ path: '/numbers' })(before) as Config
    expect(after.endpoints!.map((e) => [e.method, e.path])).toEqual([['get', '/numbers']])
    expect(after.admin!.components!.beforeDashboard).toEqual(['x#Y', '@extantape/payload-plugin-stats/admin#StatsCard'])
    expect(after.admin!.components!.views).toMatchObject({ other: { path: '/other' }, stats: { Component: '@extantape/payload-plugin-stats/admin#StatsView', path: '/numbers' } })
    expect(after.collections).toBe(before.collections) // no collection added or changed
  })

  it('leaves the card and the view out when asked', () => {
    const after = stats({ admin: { card: false, view: false } })(config()) as Config
    expect(after.admin?.components?.beforeDashboard).toBeUndefined()
    expect(after.admin?.components?.views).toBeUndefined()
    expect(after.endpoints).toHaveLength(1)
  })
})
