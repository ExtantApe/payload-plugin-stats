import type { PayloadRequest } from 'payload'

import type { ResolvedStatsOptions } from './types.js'

/** May this request see the stats? Only a signed-in user and an exact `true` from the access check. A throw is a no. */
export async function allowed(opts: ResolvedStatsOptions, req: PayloadRequest): Promise<boolean> {
  if (!req.user) return false
  try {
    return (await opts.access({ req })) === true
  } catch {
    return false
  }
}
