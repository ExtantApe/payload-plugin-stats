import type { Config, Payload, Plugin } from 'payload'

import { CUSTOM_KEY, optionsOf, resolveOptions } from './config.js'
import { statsEndpoint } from './endpoint.js'
import type { StatsOptions } from './types.js'

export { allowed } from './access.js'
export { optionsOf } from './config.js'
export { buildReport } from './report.js'
export { suppress } from './suppress.js'
export type { Block, Cell, State } from './suppress.js'
export type { StatsAccess, StatsBandOption, StatsBandReport, StatsCount, StatsFieldOption, StatsFieldReport, StatsOptions, StatsReport } from './types.js'

const ADMIN = '@extantape/payload-plugin-stats/admin'

/**
 * Stats for Payload. Counts users in total, by sign-up date, by the fields you name and by how many documents they
 * hold elsewhere. It reads numbers only, hides small groups, and shows the result to whoever the required `access`
 * function allows: a dashboard card, an admin view and a read-only JSON endpoint.
 */
export const stats =
  (options: StatsOptions): Plugin =>
  (config: Config): Config => {
    const opts = resolveOptions(config, options)
    if ((config.endpoints ?? []).some((e) => e.path === opts.path && e.method === 'get')) throw new Error(`stats: an endpoint GET ${opts.path} already exists.`)
    const components = config.admin?.components
    // A plugin listed after this one can still change a field or a collection (set hidden, add a hook). So the same
    // checks run again when Payload has started, against the config it actually runs, and every surface then works
    // from that second result. Nothing is counted before.
    opts.final = { ok: false, why: 'The check against the final config has not run yet (Payload has not finished starting, or onInit was skipped).' }
    const earlier = config.onInit
    return {
      ...config,
      endpoints: [...(config.endpoints ?? []), statsEndpoint(opts.path)],
      admin: {
        ...config.admin,
        components: {
          ...components,
          beforeDashboard: opts.admin.card ? [...(components?.beforeDashboard ?? []), `${ADMIN}#StatsCard`] : components?.beforeDashboard,
          views: opts.admin.view ? { ...components?.views, stats: { Component: `${ADMIN}#StatsView`, path: opts.path } } : components?.views,
        },
      },
      custom: { ...config.custom, [CUSTOM_KEY]: opts },
      onInit: async (payload: Payload) => {
        await earlier?.(payload)
        // Whatever options object the running config holds is the one the endpoint, the view and the card read. On a
        // pass it is overwritten, in place, with what the final config resolves to: which collection a relationship
        // points at, which field is its title, which values a field has. Nothing from the first check is left to use.
        const live = optionsOf(payload.config)
        try {
          Object.assign(live, resolveOptions(payload.config as unknown as Config, options), { final: { ok: true, why: '' } })
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          live.final = { ok: false, why }
          payload.logger.error(`stats: turned off. The config changed after the plugin first checked it (a plugin listed later?), and it no longer passes: ${why}`)
        }
      },
    }
  }
