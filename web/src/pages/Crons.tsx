import * as React from "react"
import { api, type CronJob } from "../api.ts"
import { Badge } from "../components/ui.tsx"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"

function statusToneFor(status: CronJob["lastStatus"]) {
  switch (status) {
    case "done":
      return "ok" as const
    case "pending":
      return "warn" as const
    case "inflight":
      return "info" as const
    case "scheduled":
      return "accent" as const
    default:
      return "neutral" as const
  }
}

export function CronsPage() {
  const [rows, setRows] = React.useState<CronJob[]>([])
  const { loading, error } = usePolling(async () => setRows(await api.crons()))

  if (loading && rows.length === 0) return null

  return (
    <div>
      <PageHeader
        title="Crons"
        subtitle="scheduled ClusterCron jobs — next delivery derived from stored deliver_at"
      />
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center text-[13px] text-muted">
          No cron jobs recorded. Jobs appear here once a <code>ClusterCron</code> layer runs in the
          cluster (entity types named <code>ClusterCron/&lt;name&gt;</code>).
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted">
                <th>Name</th>
                <th>Last run</th>
                <th>Next run</th>
                <th>Last status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.entityType} className="border-b border-border/60 hover:bg-surface-2/60">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted" title={fmtTime(c.lastRunAt)}>
                    {relTime(c.lastRunAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {c.nextRunAt !== null ? (
                      <span title={fmtTime(c.nextRunAt)}>{fmtCountdown(c.nextRunAt)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusToneFor(c.lastStatus)}>{c.lastStatus}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
