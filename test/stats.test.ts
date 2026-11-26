import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig, createLocalReq, getPayload, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'

import { StatsCard } from '../src/admin/Card.js'
import { StatsCardBody, StatsViewBody } from '../src/admin/Report.js'
import { resolveOptions } from '../src/config.js'
import { allowed, buildReport, optionsOf, stats, type StatsReport } from '../src/index.js'

/**
 * A made-up site: 40 accounts with an account kind (one each), roles (several each), a position (a related
 * document), per-tenant roles inside an array, and posts that point at their owner. Every name, email and number
 * here is invented for the test.
 */
const PW = 'correct-horse-battery'
const NOW = new Date()
const DAY = 86_400_000
const TODAY = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate())
const between = (n: number, from: number, to: number) => n >= from && n <= to
type Who = { collection?: string; roles?: string[] } | null
/** Who may see the stats on this site: admins from the users collection. */
const isAdmin = ({ req }: { req: PayloadRequest }) => (req.user as Who)?.collection === 'users' && (req.user as Who)?.roles?.includes('admin') === true
/** Who may open the admin panel: admins and reviewers. Wider than the stats, as on many real sites. */
const opensPanel = ({ req }: { req: PayloadRequest }) => ['admin', 'reviewer'].some((r) => (req.user as Who)?.roles?.includes(r))

let payload: Payload
const ids: string[] = []
const email = (n: number) => `user${String(n).padStart(2, '0')}@example.test`

const endpoint = () => (payload.config.endpoints as Endpoint[]).find((e) => e.path === '/stats' && e.method === 'get')!
/** The signed-in user for a token, exactly as Payload's own routes resolve it. */
const whoIs = async (token: string) => (await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })).user
async function reqAs(who: null | string, collection = 'users'): Promise<PayloadRequest> {
  const user = who ? await whoIs((await payload.login({ collection: collection as never, data: { email: who, password: PW } })).token!) : null
  const req = (await createLocalReq({ user: (user ?? undefined) as never }, payload)) as PayloadRequest
  if (!user) req.user = null
  return req
}
async function get(who: null | string, collection?: string) {
  const res = await endpoint().handler(await reqAs(who, collection))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) as StatsReport & { error?: string }, headers: res.headers }
}
const all0 = (r: StatsReport) => JSON.stringify(r)
const rows = (list: { label: string; count: { text: string } }[]) => Object.fromEntries(list.map((r) => [r.label, r.count.text]))

beforeAll(async () => {
  const config = await buildConfig({
    secret: 'test-secret-not-for-production',
    telemetry: false,
    typescript: { autoGenerate: false },
    db: mongooseAdapter({ url: inject('mongoUrl'), transactionOptions: false }),
    collections: [
      {
        slug: 'users',
        auth: true,
        access: { admin: opensPanel },
        fields: [
          { name: 'name', type: 'text' },
          { name: 'kind', type: 'select', options: ['individual', 'organization', 'charity'] },
          { name: 'roles', type: 'select', hasMany: true, options: ['admin', 'member', 'author', 'reviewer', 'moderator'], saveToJWT: true },
          { name: 'position', type: 'relationship', relationTo: 'positions' },
          { name: 'tenants', type: 'array', fields: [{ name: 'tenant', type: 'text' }, { name: 'roles', type: 'select', hasMany: true, options: ['owner', 'editor', 'viewer'] }] },
        ],
      },
      { slug: 'customers', auth: true, fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin'], saveToJWT: true }] },
      { slug: 'positions', admin: { useAsTitle: 'title' }, fields: [{ name: 'title', type: 'text' }] },
      { slug: 'posts', fields: [{ name: 'label', type: 'text' }, { name: 'owner', type: 'relationship', relationTo: 'users' }] },
    ],
    plugins: [
      stats({
        access: isAdmin,
        categories: ['positions'],
        now: () => NOW,
        fields: [
          'kind',
          { path: 'roles', label: 'Roles', groups: [{ label: 'Staff', values: ['admin', 'reviewer', 'moderator'] }] },
          { path: 'position', label: 'Positions' },
          { path: 'tenants.roles', label: 'Tenant roles' },
        ],
        bands: [{ collection: 'posts', field: 'owner', thresholds: [0, 1, 5, 10, 25, 50], label: 'Posts per user' }],
      }),
    ],
  })
  payload = await getPayload({ config })
  await payload.db.connection.dropDatabase()

  const positions: Record<string, string> = {}
  for (const title of ['Curator', 'Registrar', 'Volunteer']) positions[title] = String((await payload.create({ collection: 'positions' as never, data: { title } as never })).id)

  for (let n = 1; n <= 40; n++) {
    const roles = [n <= 2 && 'admin', n <= 36 && 'member', between(n, 3, 14) && 'author', between(n, 15, 17) && 'reviewer'].filter(Boolean)
    const tenantRoles = [n <= 10 && 'owner', between(n, 5, 19) && 'editor', between(n, 11, 35) && 'viewer'].filter(Boolean)
    const user = await payload.create({
      collection: 'users' as never,
      data: {
        email: email(n),
        password: PW,
        name: `Person ${n}`,
        kind: n <= 30 ? 'individual' : n <= 37 ? 'organization' : 'charity',
        roles,
        position: n <= 6 ? positions.Curator : n <= 8 ? positions.Registrar : n <= 28 ? positions.Volunteer : undefined,
        // Accounts 11 to 15 are viewers in two tenants: still one user each.
        tenants: tenantRoles.length ? [{ tenant: 'North', roles: tenantRoles }, ...(between(n, 11, 15) ? [{ tenant: 'South', roles: ['viewer'] }] : [])] : [],
      } as never,
    })
    ids.push(String(user.id))
  }

  // Sign-up dates: 2 today (left as they are), 2 yesterday, 7 more this week, 11 more this month, 18 older.
  const users = payload.db.collections.users!
  const age = (n: number) => (n <= 2 ? null : n <= 4 ? 0.5 : n <= 11 ? 4 : n <= 22 ? 20 : 60)
  for (let n = 1; n <= 40; n++) if (age(n) !== null) await users.updateOne({ _id: ids[n - 1] }, { $set: { createdAt: new Date(TODAY - age(n)! * DAY) } }, { timestamps: false })

  // Posts per owner: 55 and 52, three with 12, seven with 6, eight with 2, four with 1; 16 accounts have none.
  const written = (n: number) => (n === 1 ? 55 : n === 2 ? 52 : n <= 5 ? 12 : n <= 12 ? 6 : n <= 20 ? 2 : n <= 24 ? 1 : 0)
  const gone = await payload.create({ collection: 'users' as never, data: { email: 'gone@example.test', password: PW } as never })
  const posts = payload.db.collections.posts!
  const docs: Record<string, unknown>[] = []
  for (let n = 1; n <= 40; n++) for (let k = 0; k < written(n); k++) docs.push({ label: `Post ${n}-${k}`, owner: users.base.Types.ObjectId.createFromHexString(ids[n - 1]!) })
  // Posts whose owner was deleted, and posts nobody owns: neither may count as a user.
  for (let k = 0; k < 30; k++) docs.push({ label: `Orphan ${k}`, owner: users.base.Types.ObjectId.createFromHexString(String(gone.id)) })
  for (let k = 0; k < 3; k++) docs.push({ label: `Unowned ${k}` })
  await posts.insertMany(docs)
  await payload.delete({ collection: 'users' as never, id: gone.id })
  await payload.create({ collection: 'customers' as never, data: { email: 'shopper@example.test', password: PW, roles: ['admin'] } as never })
})

afterAll(async () => {
  await payload?.db.connection.dropDatabase()
  await payload?.destroy()
})

describe('the numbers', () => {
  it('counts everything correctly (minimum 2, so this made-up data shows every number)', async () => {
    const r = await buildReport(payload, { ...optionsOf(payload.config), minimum: 2 })
    expect(r.totals).toEqual({
      all: { value: 40, text: '40' },
      newYesterday: { value: 2, text: '2' },
      new7Days: { value: 9, text: '9' },
      new30Days: { value: 20, text: '20' },
    })
    const [kind, roles, position, tenant] = r.fields
    expect(kind).toMatchObject({ path: 'kind', multiple: false, any: { value: 40 }, none: { text: '0' } })
    expect(rows(kind!.values)).toEqual({ individual: '30', organization: '7', charity: '3' })

    // Admins are members too, and count as both: 36 members includes the 2 admins.
    expect(roles).toMatchObject({ label: 'Roles', multiple: true, any: { value: 36 }, none: { value: 4 } })
    expect(rows(roles!.values)).toEqual({ admin: '2', member: '36', author: '12', reviewer: '3', moderator: '0' })
    expect(rows(roles!.groups)).toEqual({ Staff: '5' })

    expect(position).toMatchObject({ label: 'Positions', multiple: false, any: { value: 28 }, none: { value: 12 } })
    expect(rows(position!.values)).toEqual({ Curator: '6', Registrar: '2', Volunteer: '20' })

    // Inside an array: a user who is a viewer in two tenants is one viewer.
    expect(tenant).toMatchObject({ label: 'Tenant roles', multiple: true, any: { value: 35 }, none: { value: 5 } })
    expect(rows(tenant!.values)).toEqual({ owner: '10', editor: '15', viewer: '25' })

    // Deleted owners and unowned posts are not users.
    expect(r.bands).toHaveLength(1)
    expect(r.bands[0]).toMatchObject({ collection: 'posts', field: 'owner', label: 'Posts per user' })
    expect(r.bands[0]!.rows.map((b) => [b.moreThan, b.count.text])).toEqual([[0, '24'], [1, '20'], [5, '12'], [10, '5'], [25, '2'], [50, '2']])
  })

  it('counts new accounts by whole UTC days', async () => {
    const at = (iso: string) => buildReport(payload, { ...optionsOf(payload.config), minimum: 2, fields: [], bands: [], now: () => new Date(iso) })
    const tomorrow = new Date(TODAY + DAY).toISOString().slice(0, 10)
    // One second into tomorrow (UTC), today's 2 sign-ups become yesterday's.
    const early = await at(`${tomorrow}T00:00:01.000Z`)
    const late = await at(`${tomorrow}T23:59:59.000Z`)
    expect(early.totals.newYesterday.value).toBe(2)
    expect(early.totals.new7Days.value).toBe(11)
    expect(late.totals).toEqual({ ...early.totals })
    // And today is never counted before it ends: at the last second of today, today's 2 are in no window.
    const tonight = await at(`${new Date(TODAY).toISOString().slice(0, 10)}T23:59:59.000Z`)
    expect([tonight.totals.newYesterday.value, tonight.totals.new7Days.value, tonight.totals.new30Days.value]).toEqual([2, 9, 20])
  })

  it('reads users only by counting: no user document is ever loaded', async () => {
    const spies = [vi.spyOn(payload.db, 'find'), vi.spyOn(payload.db, 'findOne'), vi.spyOn(payload, 'find'), vi.spyOn(payload, 'findByID'), vi.spyOn(payload.db.collections.users!, 'find'), vi.spyOn(payload.db.collections.users!, 'aggregate')]
    const counts = vi.spyOn(payload, 'count')
    await buildReport(payload, optionsOf(payload.config))
    for (const spy of spies) for (const [args] of spy.mock.calls as unknown as [{ collection?: string } | undefined][]) expect(args?.collection).not.toBe('users')
    expect(spies[4]!.mock.calls).toEqual([])
    expect(spies[5]!.mock.calls).toEqual([])
    expect(counts.mock.calls.length).toBeGreaterThan(15)
    expect(counts.mock.calls.every(([args]) => (args as { collection: string }).collection === 'users')).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('hiding small groups', () => {
  let r: StatsReport
  beforeAll(async () => {
    r = (await get(email(1))).body
  })

  it('shows no count from 1 to 4, and shows a zero as 0', () => {
    expect(r.minimum).toBe(5)
    // 2 joined yesterday.
    expect(r.totals.newYesterday).toEqual({ value: null, hidden: 'protected', text: 'hidden' })
    // Nobody is without a kind: a zero in a table that shows.
    expect(r.fields[0]!.none).toEqual({ value: 0, text: '0' })
    expect(all0(r)).not.toContain('fewer than')
    const all = JSON.stringify(r)
    for (const n of [1, 2, 3, 4]) expect(all).not.toContain(`"value":${n},`)
  })

  it('always shows the total, and the tables with nothing small in them', () => {
    expect(r.totals.all).toEqual({ value: 40, text: '40' })
    expect(r.totals.new7Days.value).toBe(9)
    expect(r.totals.new30Days.value).toBe(20)
    expect(rows(r.fields[3]!.values)).toEqual({ owner: '10', editor: '15', viewer: '25' })
    expect(r.fields[3]).toMatchObject({ any: { value: 35 }, none: { value: 5 } })
  })

  it('hides a whole table when one count in it is small, so the pattern says nothing about which', () => {
    // Kind: 3 charities. Every kind row is hidden, the 30 and the 7 too, whatever their sizes.
    expect(r.fields[0]).toMatchObject({ any: { value: 40 }, none: { text: '0' } })
    expect(rows(r.fields[0]!.values)).toEqual({ individual: 'hidden', organization: 'hidden', charity: 'hidden' })
    // Roles: 4 accounts hold no role, so the whole field is hidden, roll-up included.
    expect(r.fields[1]).toMatchObject({ any: { text: 'hidden' }, none: { text: 'hidden' } })
    expect(rows(r.fields[1]!.values)).toEqual({ admin: 'hidden', member: 'hidden', author: 'hidden', reviewer: 'hidden', moderator: 'hidden' })
    expect(rows(r.fields[1]!.groups)).toEqual({ Staff: 'hidden' })
    // Positions: 2 registrars. "Any" and "none" still show.
    expect(r.fields[2]).toMatchObject({ any: { value: 28 }, none: { value: 12 } })
    expect(rows(r.fields[2]!.values)).toEqual({ Curator: 'hidden', Registrar: 'hidden', Volunteer: 'hidden' })
    // Posts: 24 own more than 0 and 20 own more than 1, so 4 own exactly 1. The list is hidden from that step down.
    const band = Object.fromEntries(r.bands[0]!.rows.map((b) => [b.moreThan, b.count.text]))
    expect(band).toEqual({ 0: '24', 1: 'hidden', 5: 'hidden', 10: 'hidden', 25: 'hidden', 50: 'hidden' })
  })

  it('never puts a hidden number anywhere in the response', async () => {
    const hidden: unknown[] = []
    JSON.parse(JSON.stringify(r), (_k, v) => (v && typeof v === 'object' && 'hidden' in v ? hidden.push(v) : 0, v))
    expect(hidden.length).toBeGreaterThan(8)
    for (const h of hidden) expect(JSON.stringify(h)).toBe('{"value":null,"hidden":"protected","text":"hidden"}')
  })
})

describe('aggregate only', () => {
  it('has no name, email or ID anywhere in the response, the card or the view', async () => {
    const req = await reqAs(email(1))
    const outputs = [(await get(email(1))).text, renderToStaticMarkup(await StatsCardBody({ req })), renderToStaticMarkup(await StatsViewBody({ req }))]
    const positionIds = (await payload.find({ collection: 'positions' as never, limit: 10 })).docs.map((d) => String(d.id))
    for (const text of outputs) {
      expect(text).not.toMatch(/example\.test|@|Person|user\d\d/i)
      expect(text).not.toMatch(/[0-9a-f]{24}/i) // no document ID of any kind
      for (const id of [...ids, ...positionIds]) expect(text).not.toContain(id)
      expect(text).not.toMatch(/Post \d|Orphan|North|South/)
    }
  })
})

describe('admins only', () => {
  it('lets an admin read the stats, uncached', async () => {
    const res = await get(email(1))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.body.totals.all.value).toBe(40)
  })

  it('refuses a logged-out request', async () => {
    const res = await get(null)
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Sign in first.' })
  })

  const others: [string, number][] = [['an ordinary user with no role', 40], ['a member', 30], ['a author', 5], ['a reviewer (staff, but no admin)', 16]]
  it.each(others)('refuses %s', async (_name, n) => {
    const res = await get(email(n))
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'You are not allowed to see these stats.' })
  })

  it('refuses someone who may open the admin panel but is not allowed by the access function', async () => {
    // Payload's own access.admin lets this reviewer into the panel. The plugin never falls back to it.
    const req = await reqAs(email(16))
    expect(await payload.config.collections.find((c) => c.slug === 'users')!.access.admin!({ req })).toBe(true)
    expect((await get(email(16))).status).toBe(403)
    expect(await StatsCardBody({ req })).toBeNull()
  })

  it('refuses an "admin" from a different auth collection', async () => {
    const res = await get('shopper@example.test', 'customers')
    expect(res.status).toBe(403)
    expect(Object.keys(res.body)).toEqual(['error'])
  })

  it('is read-only: the plugin registers GET and nothing else, and adds no collection', () => {
    expect((payload.config.endpoints as Endpoint[]).filter((e) => e.path.includes('stats')).map((e) => e.method)).toEqual(['get'])
    expect(payload.config.collections.map((c) => c.slug).filter((s) => !s.startsWith('payload-'))).toEqual(['users', 'customers', 'positions', 'posts'])
  })

  it('takes only an exact true from a custom access check; anything else, or a throw, is a no', async () => {
    const req = await reqAs(email(1))
    const withAccess = (access: () => unknown) => allowed(resolveOptions(payload.config as never, { access: access as never }), req)
    expect(await withAccess(() => true)).toBe(true)
    expect(await withAccess(async () => true)).toBe(true)
    const noes: (() => unknown)[] = [() => false, () => 1, () => 'yes', () => ({}), () => undefined, async () => ({ ok: true }), () => { throw new Error('down') }, async () => { throw new Error('down') }]
    for (const no of noes) expect(await withAccess(no)).toBe(false)
    // A custom check never lets a logged-out request through, even if it says yes.
    expect(await allowed(resolveOptions(payload.config as never, { access: () => true }), await reqAs(null))).toBe(false)
  })

  it('answers 500 with no detail when counting fails', async () => {
    const spy = vi.spyOn(payload, 'count').mockRejectedValue(new Error('connection string mongodb://secret-host'))
    const quiet = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)
    const res = await get(email(1))
    expect(res.status).toBe(500)
    expect(res.text).not.toContain('secret-host')
    expect(quiet).toHaveBeenCalled()
    spy.mockRestore()
    quiet.mockRestore()
  })
})

describe('the admin card and view', () => {
  it('shows an admin the totals on the card, with a link to the view', async () => {
    const req = await reqAs(email(1))
    // The card hands a request for the signed-in user to its body, which is what the admin then renders.
    const card = (await StatsCard({ payload, user: req.user } as never))!
    expect(card.type).toBe(StatsCardBody)
    expect((card.props as { req: PayloadRequest }).req.user).toMatchObject({ email: email(1), collection: 'users' })
    const html = renderToStaticMarkup(await StatsCardBody(card.props as { req: PayloadRequest }))
    expect(html).toContain('<caption')
    expect(html).toMatch(/All users<\/th><td[^>]*>40</)
    expect(html).toMatch(/New yesterday<\/th><td[^>]*><span[^>]*>hidden</)
    expect(html).toContain('<a href="/admin/stats">See all stats</a>')
  })

  it('renders no card for anyone else', async () => {
    expect(await StatsCard({ payload, user: undefined } as never)).toBeNull()
    for (const n of [40, 30, 16]) expect(await StatsCardBody({ req: await reqAs(email(n)) })).toBeNull()
    expect(await StatsCardBody({ req: await reqAs(null) })).toBeNull()
    expect(await StatsCardBody({ req: await reqAs('shopper@example.test', 'customers') })).toBeNull()
  })

  it('shows an admin every table in the view, as real tables with row and column headers', async () => {
    const html = renderToStaticMarkup(await StatsViewBody({ req: await reqAs(email(1)) }))
    expect(html).toContain('<h1')
    for (const caption of ['Accounts', 'kind: high level', 'Roles: each one (a user with several is counted in each)', 'Positions: each one', 'Tenant roles: high level', 'Posts per user']) expect(html).toContain(`${caption}</caption>`)
    expect(html.match(/<table/g)).toHaveLength(10)
    expect(html.match(/scope="col"/g)).toHaveLength(20)
    expect(html).toMatch(/<th scope="row"[^>]*>More than 0<\/th><td[^>]*>24</)
    expect(html).toMatch(/Staff<\/th>/)
    expect(html).toContain('No count from 1 to 4 is shown.')
  })

  it('shows everyone else a refusal in the view and no numbers', async () => {
    for (const req of [await reqAs(null), await reqAs(email(40)), await reqAs(email(16)), await reqAs('shopper@example.test', 'customers')]) {
      const html = renderToStaticMarkup(await StatsViewBody({ req }))
      expect(html).toBe('<p>You are not allowed to see these stats.</p>')
    }
  })
})

describe('a plugin listed after stats', () => {
  // A real second Payload, on its own database, where a later plugin hides a field stats was asked to count.
  let late: Payload
  const lines: string[] = []
  beforeAll(async () => {
    const config = await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      logger: { options: { level: 'error' }, destination: { write: (line: string) => void lines.push(line) } },
      db: mongooseAdapter({ url: `${inject('mongoUrl')}-late`, transactionOptions: false }),
      collections: [{ slug: 'users', auth: true, fields: [{ name: 'isMinor', type: 'select', options: ['yes', 'no'] }] }],
      plugins: [
        stats({ access: () => true, fields: ['isMinor'] }),
        (c) => {
          const field = c.collections!.find((k) => k.slug === 'users')!.fields.find((f) => 'name' in f && f.name === 'isMinor')!
          ;(field as { hidden?: boolean }).hidden = true
          return c
        },
      ],
    })
    late = await getPayload({ config, key: 'stats-late-plugin' })
    for (let n = 0; n < 8; n++) await late.create({ collection: 'users' as never, data: { email: `late${n}@example.test`, password: PW, isMinor: n < 6 ? 'yes' : 'no' } as never })
  })
  afterAll(async () => {
    await late?.db.connection.dropDatabase()
    await late?.destroy()
  })

  it('is caught when Payload starts: the start-up log says why, and nothing is counted', async () => {
    expect(optionsOf(late.config).final).toMatchObject({ ok: false, why: expect.stringMatching(/"isMinor" is hidden/) })
    expect(lines.join('')).toMatch(/stats: turned off\..*\\"isMinor\\" is hidden/)
    const user = (await late.find({ collection: 'users' as never, limit: 1, overrideAccess: true })).docs[0] as never
    const req = (await createLocalReq({ user }, late)) as PayloadRequest
    const count = vi.spyOn(late, 'count')
    const res = await (late.config.endpoints as Endpoint[]).find((e) => e.path === '/stats')!.handler(req)
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).toContain('turned off')
    expect(text).not.toMatch(/isMinor|yes|"value"/)
    expect(renderToStaticMarkup(await StatsViewBody({ req }))).toContain('turned off')
    expect(renderToStaticMarkup((await StatsCardBody({ req }))!)).toContain('could not be counted')
    await expect(buildReport(late, optionsOf(late.config))).rejects.toThrow(/turned off/)
    expect(count).not.toHaveBeenCalled()
    count.mockRestore()
  })
})

describe('edges', () => {
  it('passes the second check on the real, started config', () => {
    expect(optionsOf(payload.config).final).toEqual({ ok: true, why: '' })
  })

  it('will not break a relationship down into more values than allowed', async () => {
    const opts = optionsOf(payload.config)
    const r = await buildReport(payload, { ...opts, fields: opts.fields.map((f) => ({ ...f, maxValues: 2 })) })
    expect(r.fields[2]).toEqual({ path: 'position', label: 'Positions', multiple: false, unavailable: 'More than 2 values; not broken down.', groups: [], values: [] })
    expect(r.fields[0]!.unavailable).toBeUndefined()
  })

  it('says so when count bands cannot run on the database adapter', async () => {
    const name = vi.spyOn(payload.db, 'name', 'get').mockReturnValue('postgres')
    const r = await buildReport(payload, optionsOf(payload.config))
    expect(r.bands[0]).toEqual({ collection: 'posts', field: 'owner', label: 'Posts per user', unavailable: 'Count bands need the MongoDB adapter.', rows: [] })
    name.mockRestore()
  })
})
