import * as React from "react"
import { api, type CronJob } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { ClockCounterClockwise } from "@phosphor-icons/react"
import { Checkbox, Empty } from "../kumo"
import { FilterChip, ScheduledBadge, SkeletonTable, SortableTh, STICKY_TH, useHashParam, useSort } from "../components/pieces.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { useExport } from "../export.ts"
import { Button } from "../components/ui.tsx"

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
  const [overdueOnlyParam, setOverdueOnly] = useHashParam("overdue")
  const overdueOnly = overdueOnlyParam === "1"
  const setOverdueOnlyParam = (v: boolean) => setOverdueOnly(v ? "1" : "")
  const { loading, error, refresh } = usePolling(async () => setRows(await api.crons()))
  const sort = useSort<CronJob>()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const facetDefs: FacetDef<CronJob>[] = [
    {
      key: "status",
      label: "last run",
      options: (all) => [...new Set(all.map((c) => c.lastStatus))].map((v) => ({ value: v })),
      predicate: (c, v) => v.includes(c.lastStatus)
    },
    {
      key: "namespace",
      label: "namespace",
      options: (all) =>
        [...new Set(all.map((c) => (c.name.split("/")[0] ?? c.name)))].map((v) => ({ value: v })),
      predicate: (c, v) => v.some((n) => c.name.startsWith(n))
    },
    presenceFacet("overdue", "overdue", (c) => c.lastStatus !== "done" && c.nextRunAt !== null && c.nextRunAt < Date.now())
  ]
  const facets = useFacets(rows, facetDefs)

  // hooks must run unconditionally (early return below would break the rules of hooks)
  const overdue = (c: CronJob) =>
    c.lastStatus !== "done" && c.nextRunAt !== null && c.nextRunAt < Date.now()
  const visible = facets.filtered.filter((c) => !overdueOnly || overdue(c))
  const exportRows = React.useMemo(
    () =>
      visible.map((c) => ({
        name: c.name,
        entityType: c.entityType,
        lastStatus: c.lastStatus,
        lastRunAt: c.lastRunAt,
        nextRunAt: c.nextRunAt
      })),
    [visible]
  )
  const exporters = useExport(exportRows, "crons")

  if (loading && rows.length === 0) return <SkeletonTable />

  return (
    <div>
      <PageHeader
        title="Crons"
        subtitle="scheduled ClusterCron jobs — next delivery derived from stored deliver_at"
      >
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-kumo-subtle">
          <Checkbox checked={overdueOnly} onCheckedChange={(checked) => setOverdueOnlyParam(Boolean(checked))} />
          overdue only
        </label>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={exportRows.length === 0} onClick={exporters.json}>
            export page (json)
          </Button>
          <Button variant="ghost" size="sm" disabled={exportRows.length === 0} onClick={exporters.csv}>
            export page (csv)
          </Button>
        </span>
      </PageHeader>
      <FilterBar defs={facetDefs} rows={rows} facets={facets} />
      <ErrorNote error={error} onRetry={refresh} />
      {(overdueOnly || sort.sortKey !== null) && (
        <div className="mb-2 flex items-center gap-1.5">
          {overdueOnly && <FilterChip label="overdue only" onRemove={() => setOverdueOnlyParam(false)} />}
          {sort.sortKey !== null && (
            <FilterChip
              label={`sort: ${sort.sortKey} ${sort.dir === "asc" ? "▲" : "▼"}`}
              onRemove={() => sort.toggle(sort.sortKey!)}
            />
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <Empty
          icon={<ClockCounterClockwise className="h-8 w-8 text-kumo-subtle" />}
          title="No cron jobs recorded"
          description="Jobs appear here once a ClusterCron layer runs in the cluster."
          commandLine="entity types named ClusterCron/<name>"
          className="rounded-lg border border-kumo-line bg-kumo-base"
        />
      ) : visible.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-kumo-line bg-kumo-base">
          <Table>
            <THead>
              <TR>
                <SortableTh label="Name" sortKey="name" sort={sort} />
                <SortableTh label="Last run" sortKey="lastRunAt" sort={sort} />
                <SortableTh label="Next run" sortKey="nextRunAt" sort={sort} />
                <TH className={STICKY_TH}>Last status</TH>
              </TR>
            </THead>
            <TBody>
              {sort.sorted(visible).map((c) => (
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
                    {/* A7: scheduled must not read as info-blue like in-flight */}
                    {c.lastStatus === "scheduled" ? (
                      <ScheduledBadge label="scheduled" />
                    ) : (
                      <Badge tone={statusToneFor(c.lastStatus)}>{c.lastStatus}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-8 text-center text-[13px] text-kumo-subtle">
          no cron jobs match the current filters
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
