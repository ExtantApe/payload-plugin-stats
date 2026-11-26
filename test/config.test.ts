import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../src/config.js'
import { buildReport, optionsOf, stats, type StatsAccess, type StatsOptions } from '../src/index.js'

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
    { name: 'profile', type: 'relationship', relationTo: 'profiles' },
    // Fields with their own read rules, and one with a rule that is not about reading.
    { name: 'ageBand', type: 'select', options: ['under13', 'adult'], access: { read: () => false } },
    { name: 'tier', type: 'select', options: ['free', 'paid'], access: { read: () => true } },
    { name: 'plan', type: 'select', options: ['free', 'paid'], access: { update: () => false } },
    { name: 'secret', type: 'group', access: { read: () => false }, fields: [{ name: 'level', type: 'select', options: ['one', 'two'] }] },
    { name: 'memberships', type: 'array', access: { read: () => false }, fields: [{ name: 'role', type: 'select', options: ['owner', 'viewer'] }] },
    // Fields the site keeps from readers in other ways: hidden, under a hidden group, or stripped by an afterRead hook.
    { name: 'isMinor', type: 'select', options: ['yes', 'no'], hidden: true },
    { name: 'guardian', type: 'group', hidden: true, fields: [{ name: 'consent', type: 'select', options: ['given', 'pending'] }] },
    { name: 'school', type: 'select', options: ['primary', 'secondary'], hooks: { afterRead: [() => undefined] } },
    { name: 'household', type: 'array', hooks: { afterRead: [() => []] }, fields: [{ name: 'size', type: 'select', options: ['small', 'large'] }] },
    { name: 'region', type: 'select', options: ['north', 'south'], hooks: { afterRead: [], beforeChange: [({ value }) => value] } },
    // Virtual fields: one that reads through a relationship, and a plain one with no hook.
    { name: 'minorViaRead', type: 'select', options: ['yes', 'no'], virtual: 'profile.isMinorRead' },
    { name: 'linked', type: 'group', virtual: 'profile.details', fields: [{ name: 'level', type: 'select', options: ['one', 'two'] }] } as never,
    { name: 'computed', type: 'select', options: ['a', 'b'], virtual: true },
    // Payload treats any truthy `hidden` as hidden.
    { name: 'flagged', type: 'select', options: ['a', 'b'], hidden: 1 as never },
    { name: 'crew', type: 'relationship', relationTo: 'crews' },
    { name: 'rank', type: 'relationship', relationTo: 'ranks' },
    { name: 'team', type: 'relationship', relationTo: 'teams' },
    { name: 'tenants', type: 'array', fields: [{ type: 'row', fields: [{ name: 'roles', type: 'select', options: ['owner', 'viewer'] }] }] },
    { type: 'tabs', tabs: [{ label: 'More', fields: [{ name: 'details', type: 'group', fields: [{ name: 'level', type: 'select', options: ['one', 'two'] }] }] }] },
  ],
  ...extra,
})
const config = (u = users()): Config =>
  ({
    collections: [
      u,
      { slug: 'positions', admin: { useAsTitle: 'title' }, fields: [{ name: 'title', type: 'text' }] },
      // One document per person, titled by their name, and not an auth collection.
      { slug: 'profiles', admin: { useAsTitle: 'fullName' }, fields: [{ name: 'fullName', type: 'text' }] },
      { slug: 'teams', admin: { useAsTitle: 'name' }, fields: [{ name: 'name', type: 'text', access: { read: () => false } }] },
      { slug: 'crews', admin: { useAsTitle: 'name' }, fields: [{ name: 'name', type: 'text', hidden: true }] },
      { slug: 'members', auth: true, fields: [] },
      // Collections with collection-level read hooks.
      { slug: 'logs', hooks: { afterRead: [({ doc }) => doc] }, fields: [{ name: 'by', type: 'relationship', relationTo: 'users' }] },
      { slug: 'drafts', hooks: { beforeRead: [({ doc }) => doc] }, fields: [{ name: 'by', type: 'relationship', relationTo: 'users' }] },
      { slug: 'ranks', admin: { useAsTitle: 'title' }, hooks: { afterRead: [({ doc }) => doc] }, fields: [{ name: 'title', type: 'text' }] },
      {
        slug: 'posts',
        fields: [
          { name: 'owner', type: 'relationship', relationTo: 'users' },
          { name: 'carers', type: 'relationship', relationTo: 'users', hasMany: true },
          { name: 'home', type: 'relationship', relationTo: 'positions' },
          { name: 'editor', type: 'relationship', relationTo: 'users', access: { read: () => false } },
          { name: 'ghost', type: 'relationship', relationTo: 'users', hidden: true },
          { name: 'reader', type: 'relationship', relationTo: 'users', hooks: { afterRead: [() => null] } },
          { name: 'proxy', type: 'relationship', relationTo: 'users', virtual: 'home.lead' },
          { name: 'visits', type: 'array', fields: [{ name: 'by', type: 'relationship', relationTo: 'users' }] },
        ],
      },
    ],
  }) as Config
/** Options with the required access function filled in. */
const resolve = (options: Partial<StatsOptions> = {}, c = config()) => resolveOptions(c, { access: isAdmin as StatsAccess, ...options })

describe('options', () => {
  it('fills in the defaults', () => {
    const o = resolve()
    expect(o).toMatchObject({ users: 'users', minimum: 5, path: '/stats', admin: { card: true, view: true }, fields: [], bands: [] })
    expect(o.access).toBe(isAdmin)
  })

  it('finds fields by path, through arrays, rows, tabs and groups, and knows which ones overlap', () => {
    const o = resolve({ categories: ['positions'], fields: ['roles', 'kind', 'tenants.roles', 'details.level', { path: 'position', label: 'Jobs' }] })
    expect(o.fields.map((f) => [f.path, f.kind, f.multiple, f.label])).toEqual([
      ['roles', 'options', true, 'roles'],
      ['kind', 'options', false, 'kind'],
      ['tenants.roles', 'options', true, 'tenants.roles'],
      ['details.level', 'options', false, 'details.level'],
      ['position', 'relationship', false, 'Jobs'],
    ])
    expect(o.fields[0]!.options).toEqual([{ label: 'admin', value: 'admin' }, { label: 'Member', value: 'member' }])
    expect(o.fields[4]).toMatchObject({ relationTo: 'positions', titleField: 'title', maxValues: 50 })
  })

  it('sorts and de-duplicates band thresholds and has a default set', () => {
    const o = resolve({ bands: [{ collection: 'posts', field: 'owner' }, { collection: 'posts', field: 'carers', thresholds: [10, 0, 10, 3] }] })
    expect(o.bands.map((b) => [b.field, b.hasMany, b.thresholds])).toEqual([['owner', false, [1, 5, 10, 25, 50]], ['carers', true, [0, 3, 10]]])
  })

  it('counts a field whose only access rule is not about reading', () => {
    expect(resolve({ fields: ['plan'] }).fields[0]).toMatchObject({ path: 'plan', kind: 'options' })
  })

  it('counts a field whose hooks do not touch reading', () => {
    expect(resolve({ fields: ['region'] }).fields[0]).toMatchObject({ path: 'region', kind: 'options' })
  })

  it('counts a virtual field that is plain (virtual: true, no hook)', () => {
    expect(resolve({ fields: ['computed'] }).fields[0]).toMatchObject({ path: 'computed', kind: 'options' })
  })

  it('takes collections with read hooks once the site names them, and category collections either way', () => {
    const hooked = config(users({ hooks: { afterRead: [({ doc }) => doc], beforeRead: [({ doc }) => doc] } }))
    const o = resolve({ allowCollectionReadHooks: ['users', 'logs', 'drafts'], bands: [{ collection: 'logs', field: 'by' }, { collection: 'drafts', field: 'by' }] }, hooked)
    expect(o.bands.map((b) => b.collection)).toEqual(['logs', 'drafts'])
    // Hooks that are not about reading need no opt-in.
    expect(resolve({}, config(users({ hooks: { afterRead: [], beforeChange: [({ data }) => data] } }))).users).toBe('users')
    // Category titles are read with payload.find, which runs the collection's read hooks, so nothing is bypassed.
    expect(resolve({ categories: ['ranks'], fields: ['rank'] }).fields[0]).toMatchObject({ relationTo: 'ranks', titleField: 'title' })
  })

  it('never uses an ID as a row label', () => {
    const c = config()
    c.collections!.find((k) => k.slug === 'positions')!.admin = { useAsTitle: 'id' }
    expect(resolve({ categories: ['positions'], fields: ['position'] }, c).fields[0]!.titleField).toBeUndefined()
  })

  describe('access is a required function', () => {
    // The users collection here has an access.admin check. It is not used: it only says who may open the admin panel.
    it('refuses to start with no options, or with no access', () => {
      expect(() => (stats as unknown as () => (c: Config) => Config)()(config())).toThrow(/access option is required/)
      expect(() => resolveOptions(config(), {} as StatsOptions)).toThrow(/access option is required and must be a function/)
      expect(() => resolveOptions(config(), { fields: ['roles'] } as StatsOptions)).toThrow(/There is no default/)
      expect(() => stats({} as StatsOptions)(config())).toThrow(/access option is required/)
    })

    const notFunctions: [string, unknown][] = [['true', true], ['"yes"', 'yes'], ['1', 1], ['{}', {}], ['false', false], ['null', null], ['undefined', undefined], ['[]', []]]
    it.each(notFunctions)('refuses access: %s', (_name, access) => {
      expect(() => resolveOptions(config(), { access } as unknown as StatsOptions)).toThrow(/access option is required and must be a function/)
      expect(() => stats({ access } as unknown as StatsOptions)(config())).toThrow(/must be a function/)
    })
  })

  const refusals: [string, () => unknown, RegExp][] = [
    ['a users collection that is missing', () => resolve({ users: 'people' }), /no auth collection "people"/],
    ['a users collection without sign-in', () => resolve({ users: 'positions' }), /no auth collection/],
    ['users without timestamps', () => resolve({}, config(users({ timestamps: false }))), /timestamps/],
    ['a minimum of 1, which would hide nothing', () => resolve({ minimum: 1 }), /2 or more/],
    ['a minimum that is not whole', () => resolve({ minimum: 2.5 }), /2 or more/],
    ['a path that could escape', () => resolve({ path: '/stats/../users' as never }), /path/],
    ['a field that does not exist', () => resolve({ fields: ['nope'] }), /no field "nope"/],
    ['a free-text field', () => resolve({ fields: ['bio'] }), /text field/],
    ['a localized field', () => resolve({ fields: ['motto'] }), /localized/],
    ['a relationship to accounts, which would count by person', () => resolve({ fields: ['buddy'] }), /Counting by person is refused/],
    ['a relationship to several collections', () => resolve({ categories: ['positions'], fields: ['thing'] }), /several collections/],
    ['a relationship whose collection is not listed as categories', () => resolve({ fields: ['position'] }), /list "positions" in the categories option/],
    ['a relationship to one-per-person profiles, with another collection listed', () => resolve({ categories: ['positions'], fields: ['profile'] }), /list "profiles" in the categories option/],
    ['categories that is not a list of slugs', () => resolve({ categories: 'positions' as never }), /list of collection slugs/],
    ['categories naming a collection that is missing', () => resolve({ categories: ['zoo'] }), /categories: no collection "zoo"/],
    ['categories naming an auth collection', () => resolve({ categories: ['members'] }), /"members" is an auth collection/],
    ['a relationship to accounts even when someone lists them as categories', () => resolve({ categories: ['users'], fields: ['buddy'] }), /auth collection/],
    ['a field with read access that says no', () => resolve({ fields: ['ageBand'] }), /"ageBand" has its own read access/],
    ['a field with read access that says yes', () => resolve({ fields: ['tier'] }), /"tier" has its own read access/],
    ['a field inside a group with read access', () => resolve({ fields: ['secret.level'] }), /"secret" has its own read access/],
    ['a field inside an array with read access', () => resolve({ fields: ['memberships.role'] }), /"memberships" has its own read access/],
    ['a relationship whose title field has read access', () => resolve({ categories: ['teams'], fields: ['team'] }), /"teams.name" has its own read access/],
    ['a band field with read access', () => resolve({ bands: [{ collection: 'posts', field: 'editor' }] }), /"editor" has its own read access/],
    ['a hidden field (the review found an isMinor field counted as yes 6, no 24)', () => resolve({ fields: ['isMinor'] }), /"isMinor" is hidden \(hidden is set\)\. A count would show what that hides/],
    ['a field whose hidden is truthy but not true', () => resolve({ fields: ['flagged'] }), /"flagged" is hidden/],
    ['a virtual field that reads through a relationship (the review found one counted as yes 3, no 7)', () => resolve({ fields: ['minorViaRead'] }), /"minorViaRead" is virtual and takes its value from "profile.isMinorRead"/],
    ['a field inside a group that is virtual through a relationship', () => resolve({ fields: ['linked.level'] }), /"linked" is virtual/],
    ['a band field that is virtual through a relationship', () => resolve({ bands: [{ collection: 'posts', field: 'proxy' }] }), /"proxy" is virtual/],
    ['a users collection with a collection-level afterRead hook', () => resolve({}, config(users({ hooks: { afterRead: [({ doc }) => doc] } }))), /users collection "users" has a collection-level afterRead hook.*allowCollectionReadHooks/],
    ['a users collection with a collection-level beforeRead hook', () => resolve({}, config(users({ hooks: { beforeRead: [({ doc }) => doc] } }))), /collection-level beforeRead hook/],
    ['a band collection with a collection-level afterRead hook', () => resolve({ bands: [{ collection: 'logs', field: 'by' }] }), /band collection "logs" has a collection-level afterRead hook/],
    ['a band collection with a collection-level beforeRead hook', () => resolve({ bands: [{ collection: 'drafts', field: 'by' }] }), /band collection "drafts" has a collection-level beforeRead hook/],
    ['a read hook allowed on another collection only', () => resolve({ allowCollectionReadHooks: ['logs'], bands: [{ collection: 'drafts', field: 'by' }] }), /band collection "drafts"/],
    ['allowCollectionReadHooks that is not a list of slugs', () => resolve({ allowCollectionReadHooks: 'users' as never }), /allowCollectionReadHooks must be a list/],
    ['allowCollectionReadHooks naming a collection that is missing', () => resolve({ allowCollectionReadHooks: ['zoo'] }), /allowCollectionReadHooks: no collection "zoo"/],
    ['a field inside a hidden group', () => resolve({ fields: ['guardian.consent'] }), /"guardian" is hidden/],
    ['a field with an afterRead hook', () => resolve({ fields: ['school'] }), /"school" has an afterRead hook/],
    ['a field inside an array with an afterRead hook', () => resolve({ fields: ['household.size'] }), /"household" has an afterRead hook/],
    ['a relationship whose title field is hidden', () => resolve({ categories: ['crews'], fields: ['crew'] }), /"crews.name" is hidden/],
    ['a hidden band field', () => resolve({ bands: [{ collection: 'posts', field: 'ghost' }] }), /"ghost" is hidden/],
    ['a band field with an afterRead hook', () => resolve({ bands: [{ collection: 'posts', field: 'reader' }] }), /"reader" has an afterRead hook/],
    ['two bands on the same field, whose difference would show a small group', () => resolve({ bands: [{ collection: 'posts', field: 'owner', thresholds: [0, 2] }, { collection: 'posts', field: 'owner', thresholds: [1, 2] }] }), /band "posts.owner" is listed twice/],
    ['the same band twice, thresholds and all', () => resolve({ bands: [{ collection: 'posts', field: 'owner' }, { collection: 'posts', field: 'owner' }] }), /listed twice/],
    ['a path through a plain field', () => resolve({ fields: ['kind.x'] }), /must be a group or an array/],
    ['a roll-up naming an unknown value', () => resolve({ fields: [{ path: 'roles', groups: [{ label: 'Staff', values: ['boss'] }] }] }), /not an option/],
    ['a roll-up on a relationship', () => resolve({ categories: ['positions'], fields: [{ path: 'position', groups: [{ label: 'x', values: [] }] }] }), /groups are for select/],
    ['the same field twice', () => resolve({ fields: ['roles', { path: 'roles' }] }), /twice/],
    ['a band on a missing collection', () => resolve({ bands: [{ collection: 'zoo', field: 'owner' }] }), /no collection "zoo"/],
    ['a band field that points elsewhere', () => resolve({ bands: [{ collection: 'posts', field: 'home' }] }), /relationship to "users" only/],
    ['a band field inside an array', () => resolve({ bands: [{ collection: 'posts', field: 'visits.by' }] }), /inside an array/],
    ['a negative band threshold', () => resolve({ bands: [{ collection: 'posts', field: 'owner', thresholds: [-1] }] }), /whole numbers/],
    ['an endpoint already at the path', () => stats({ access: isAdmin as StatsAccess })({ ...config(), endpoints: [{ path: '/stats', method: 'get', handler: () => new Response() }] }), /already exists/],
  ]
  it.each(refusals)('refuses %s at start-up', (_name, run, message) => {
    expect(run).toThrow(message)
  })

  it('adds one GET endpoint, the card and the view, and keeps what was there', () => {
    const before = { ...config(), admin: { components: { beforeDashboard: ['x#Y'], views: { other: { Component: 'a#B', path: '/other' as const } } } } }
    const after = stats({ access: isAdmin as StatsAccess, path: '/numbers' })(before) as Config
    expect(after.endpoints!.map((e) => [e.method, e.path])).toEqual([['get', '/numbers']])
    expect(after.admin!.components!.beforeDashboard).toEqual(['x#Y', '@extantape/payload-plugin-stats/admin#StatsCard'])
    expect(after.admin!.components!.views).toMatchObject({ other: { path: '/other' }, stats: { Component: '@extantape/payload-plugin-stats/admin#StatsView', path: '/numbers' } })
    expect(after.collections).toBe(before.collections) // no collection added or changed
  })

  describe('the second check, when Payload has started', () => {
    const logged: string[] = []
    const started = (c: Config) => ({ config: c, logger: { error: (m: string) => logged.push(m) } }) as never
    const ask = async (c: Config) => {
      const res = await c.endpoints![0]!.handler({ user: { roles: ['admin'] }, payload: { config: c, logger: { error: () => undefined } } } as never)
      return [res.status, ((await res.json()) as { error?: string }).error]
    }

    it('counts nothing until it has run', async () => {
      const after = stats({ access: isAdmin as StatsAccess, fields: ['kind'] })(config()) as Config
      expect(optionsOf(after).final).toMatchObject({ ok: false, why: expect.stringMatching(/has not run yet/) })
      expect(await ask(after)).toEqual([503, expect.stringMatching(/turned off/)])
      await expect(buildReport({} as never, optionsOf(after))).rejects.toThrow(/turned off/)
    })

    it('runs the site\'s own onInit first, then passes a config nobody changed', async () => {
      const order: string[] = []
      const after = stats({ access: isAdmin as StatsAccess, fields: ['kind'] })({ ...config(), onInit: () => void order.push('site') }) as Config
      await after.onInit!(started(after))
      expect(order).toEqual(['site'])
      expect(optionsOf(after).final).toEqual({ ok: true, why: '' })
    })

    it('replaces what the first check resolved with what the final config resolves to', async () => {
      const after = stats({ access: isAdmin as StatsAccess, categories: ['positions', 'ranks'], fields: ['position'] })(config()) as Config
      const live = optionsOf(after)
      expect(live.fields[0]).toMatchObject({ relationTo: 'positions', titleField: 'title' })
      // A later plugin points the field at another listed category, and changes that collection's title field.
      ;(after.collections![0]!.fields.find((f) => 'name' in f && f.name === 'position') as { relationTo: string }).relationTo = 'ranks'
      const ranks = after.collections!.find((c) => c.slug === 'ranks')!
      ranks.fields.push({ name: 'code', type: 'text' })
      ranks.admin = { useAsTitle: 'code' }
      await after.onInit!(started(after))
      // The same object the endpoint, the view and the card read, now holding the second result.
      expect(optionsOf(after)).toBe(live)
      expect(live.final).toEqual({ ok: true, why: '' })
      expect(live.fields[0]).toMatchObject({ relationTo: 'ranks', titleField: 'code' })
    })

    it('turns the stats off, and logs why, when a later plugin hid a counted field or added a read hook', async () => {
      for (const [change, why] of [
        [(u: CollectionConfig) => ((u.fields.find((f) => 'name' in f && f.name === 'kind') as { hidden?: boolean }).hidden = true), /"kind" is hidden/],
        [(u: CollectionConfig) => (u.hooks = { afterRead: [({ doc }) => doc] }), /collection-level afterRead hook/],
      ] as const) {
        logged.length = 0
        const after = stats({ access: isAdmin as StatsAccess, fields: ['kind'] })(config()) as Config
        change(after.collections![0]!)
        await after.onInit!(started(after))
        expect(optionsOf(after).final).toMatchObject({ ok: false, why: expect.stringMatching(why) })
        expect(logged).toEqual([expect.stringMatching(/^stats: turned off\..*no longer passes/)])
        expect(logged[0]).toMatch(why)
        // The answer names no field: the reason stays in the log.
        expect(await ask(after)).toEqual([503, 'The stats are turned off, because a start-up check of the site configuration did not pass. The server log says why.'])
      }
    })
  })

  it('leaves the card and the view out when asked', () => {
    const after = stats({ access: isAdmin as StatsAccess, admin: { card: false, view: false } })(config()) as Config
    expect(after.admin?.components?.beforeDashboard).toBeUndefined()
    expect(after.admin?.components?.views).toBeUndefined()
    expect(after.endpoints).toHaveLength(1)
  })
})
