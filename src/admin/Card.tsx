import { createLocalReq, type ServerProps } from 'payload'

import { StatsCardBody } from './Report.js'

/** Dashboard card (`admin.components.beforeDashboard`). A server component. */
export async function StatsCard({ payload, user }: ServerProps) {
  if (!user) return null
  const req = await createLocalReq({ user }, payload)
  return <StatsCardBody req={req} />
}
