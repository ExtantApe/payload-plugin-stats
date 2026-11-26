import type { PayloadRequest } from 'payload'
import type { CSSProperties, ReactNode } from 'react'

import { allowed } from '../access.js'
import { optionsOf } from '../config.js'
import { buildReport } from '../report.js'
import type { StatsCount, StatsReport } from '../types.js'

/** Plain server-rendered markup: real tables and headings, the admin's own colors, no client code. */

const s = {
  table: { borderCollapse: 'collapse', width: '100%', maxWidth: '40rem', marginBottom: 'calc(var(--base, 1.25rem) * 1.5)' },
  caption: { textAlign: 'left', fontWeight: 600, padding: '0 0 0.5rem' },
  th: { textAlign: 'left', fontWeight: 400, padding: '0.5rem 1rem 0.5rem 0', borderTop: '1px solid var(--theme-elevation-150, #ddd)' },
  td: { textAlign: 'right', padding: '0.5rem 0', borderTop: '1px solid var(--theme-elevation-150, #ddd)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  head: { textAlign: 'right', fontWeight: 600, padding: '0.5rem 0' },
  quiet: { color: 'var(--theme-elevation-800, #444)' },
  card: { border: '1px solid var(--theme-elevation-150, #ddd)', borderRadius: 'var(--style-radius-m, 4px)', padding: 'var(--base, 1.25rem)', marginBottom: 'var(--base, 1.25rem)', maxWidth: '40rem' },
} satisfies Record<string, CSSProperties>

function Count({ count }: { count: StatsCount }) {
  return count.hidden ? <span style={s.quiet}>{count.text}</span> : <>{count.text}</>
}

function Table({ caption, rows, what }: { caption: string; rows: { count: StatsCount; label: ReactNode }[]; what: string }) {
  return (
    <table style={s.table}>
      <caption style={s.caption}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" style={{ ...s.th, borderTop: 'none', fontWeight: 600 }}>
            {what}
          </th>
          <th scope="col" style={s.head}>
            Users
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row" style={s.th}>
              {r.label}
            </th>
            <td style={s.td}>
              <Count count={r.count} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const totalsRows = (report: StatsReport) => [
  { label: 'All users', count: report.totals.all },
  { label: 'New yesterday', count: report.totals.newYesterday },
  { label: 'New in the last 7 days', count: report.totals.new7Days },
  { label: 'New in the last 30 days', count: report.totals.new30Days },
]

export function HidingNote({ report }: { report: StatsReport }) {
  return (
    <p style={{ ...s.quiet, maxWidth: '40rem' }}>
      Counts only: no names, emails or IDs. No count from 1 to {report.minimum - 1} is shown. When a table holds one, or one could be worked out by subtracting, its counts show as hidden, and a list of
      steps shows as hidden from that step down. A zero shows as fewer than {report.minimum}. New-account counts cover whole days that have ended, in UTC.
    </p>
  )
}

export function StatsReportTables({ report }: { report: StatsReport }) {
  return (
    <div>
      <HidingNote report={report} />
      <Table caption="Accounts" rows={totalsRows(report)} what="Count" />
      {report.fields.map((f) =>
        f.unavailable ? (
          <p key={f.path}>
            <strong>{f.label}:</strong> {f.unavailable}
          </p>
        ) : (
          <div key={f.path}>
            <Table
              caption={`${f.label}: high level`}
              rows={[{ label: 'Any of these', count: f.any! }, { label: 'None of these', count: f.none! }, ...f.groups.map((g) => ({ label: g.label, count: g.count }))]}
              what="Group"
            />
            <Table caption={`${f.label}: each one${f.multiple ? ' (a user with several is counted in each)' : ''}`} rows={f.values} what="Value" />
          </div>
        ),
      )}
      {report.bands.map((b) =>
        b.unavailable ? (
          <p key={`${b.collection}.${b.field}`}>
            <strong>{b.label}:</strong> {b.unavailable}
          </p>
        ) : (
          <Table caption={b.label} key={`${b.collection}.${b.field}`} rows={b.rows.map((r) => ({ label: `More than ${r.moreThan}`, count: r.count }))} what="Has" />
        ),
      )}
      <p style={s.quiet}>
        Counted <time dateTime={report.generatedAt}>{report.generatedAt.slice(0, 16).replace('T', ' ')} UTC</time>.
      </p>
    </div>
  )
}

/** The view's content. Checks access itself, so it is safe wherever it is rendered. */
export async function StatsViewBody({ req }: { req: PayloadRequest }) {
  const opts = optionsOf(req.payload.config)
  if (!(await allowed(opts, req))) return <p>You are not allowed to see these stats.</p>
  let report: StatsReport
  try {
    report = await buildReport(req.payload, opts)
  } catch (error) {
    req.payload.logger.error({ err: error, msg: 'stats: could not build the report' })
    return <p role="alert">The stats could not be counted. Reload the page to try again.</p>
  }
  return (
    <div>
      <h1 style={{ marginBottom: 'var(--base, 1.25rem)' }}>Stats</h1>
      <StatsReportTables report={report} />
    </div>
  )
}

/** The dashboard card's content: the account totals and a link to the view. Renders nothing for anyone not allowed. */
export async function StatsCardBody({ req }: { req: PayloadRequest }) {
  const opts = optionsOf(req.payload.config)
  if (!(await allowed(opts, req))) return null
  let report: StatsReport
  try {
    report = await buildReport(req.payload, opts)
  } catch (error) {
    req.payload.logger.error({ err: error, msg: 'stats: could not build the report' })
    return (
      <section aria-label="Stats" style={s.card}>
        <p role="alert">The stats could not be counted.</p>
      </section>
    )
  }
  return (
    <section aria-label="Stats" style={s.card}>
      <Table caption="Stats" rows={totalsRows(report)} what="Accounts" />
      {opts.admin.view ? <a href={`${req.payload.config.routes.admin.replace(/\/$/, '')}${opts.path}`}>See all stats</a> : null}
    </section>
  )
}
