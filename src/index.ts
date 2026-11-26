import type { Config, Plugin } from 'payload'

import { CUSTOM_KEY, resolveOptions } from './config.js'
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
    }
  }
