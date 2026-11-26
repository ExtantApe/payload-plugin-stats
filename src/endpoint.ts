import type { Endpoint } from 'payload'

import { allowed } from './access.js'
import { optionsOf } from './config.js'
import { buildReport } from './report.js'

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const TURNED_OFF = 'The stats are turned off, because a start-up check of the site configuration did not pass. The server log says why.'

/** GET only. The plugin registers no other method, so there is nothing to write through. */
export const statsEndpoint = (path: string): Endpoint => ({
  path,
  method: 'get',
  handler: async (req) => {
    const opts = optionsOf(req.payload.config)
    if (!req.user) return json({ error: 'Sign in first.' }, 401)
    if (!(await allowed(opts, req))) return json({ error: 'You are not allowed to see these stats.' }, 403)
    // The check against the final config failed or has not run. The reason is in the start-up log, not here.
    if (opts.final && !opts.final.ok) return json({ error: TURNED_OFF }, 503)
    try {
      return json(await buildReport(req.payload, opts), 200)
    } catch (error) {
      req.payload.logger.error({ err: error, msg: 'stats: could not build the report' })
      return json({ error: 'The stats could not be counted. Try again.' }, 500)
    }
  },
})
