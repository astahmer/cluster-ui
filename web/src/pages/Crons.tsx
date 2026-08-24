import * as React from "react"
import { api, type CronJob } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { ClockCounterClockwise } from "@phosphor-icons/react"
import { Empty } from "../kumo"
import { SkeletonTable } from "../components/pieces.tsx"

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
  const { loading, error, refresh } = usePolling(async () => setRows(await api.crons()))

  if (loading && rows.length === 0) return <SkeletonTable />

  const overdue = (c: CronJob) =>
    c.lastStatus !== "done" && c.nextRunAt !== null && c.nextRunAt < Date.now()

  return (
    <div>
      <PageHeader
        title="Crons"
        subtitle="scheduled ClusterCron jobs — next delivery derived from stored deliver_at"
      />
      <ErrorNote error={error} onRetry={refresh} />
      {rows.length === 0 ? (
        <Empty
          icon={<ClockCounterClockwise className="h-8 w-8 text-kumo-subtle" />}
          title="No cron jobs recorded"
          description="Jobs appear here once a ClusterCron layer runs in the cluster."
          commandLine="entity types named ClusterCron/<name>"
          className="rounded-lg border border-kumo-line bg-kumo-base"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-kumo-line bg-kumo-base">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Last run</TH>
                <TH>Next run</TH>
                <TH>Last status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.entityType} className={overdue(c) ? "bg-kumo-danger-tint/50" : undefined}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="whitespace-nowrap text-kumo-subtle" title={fmtTime(c.lastRunAt)}>
                    {relTime(c.lastRunAt)}
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums">
                    {c.nextRunAt !== null ? (
                      <span title={fmtTime(c.nextRunAt)}>{fmtCountdown(c.nextRunAt)}</span>
                    ) : (
                      <span className="text-kumo-subtle">—</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={statusToneFor(c.lastStatus)}>{c.lastStatus}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {rows.some(overdue) && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-kumo-danger">
          Rows highlighted red have a next-run time already in the past — the cron entity is
          likely stuck or its runner went away.
        </p>
      )}
    </div>
  )
}
