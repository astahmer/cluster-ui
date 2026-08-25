import * as React from "react"
import { Cpu } from "@phosphor-icons/react"
import { api, type Runner } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { SkeletonTable, SortableTh, useSort } from "../components/pieces.tsx"

export function RunnersPage() {
  const [rows, setRows] = React.useState<Runner[]>([])
  const { loading, error, refresh } = useLive(async () => setRows(await api.runners()))
  const sort = useSort<Runner>()

  if (loading && rows.length === 0) return <SkeletonTable />
  const totalShards = rows.reduce((acc, r) => acc + r.shards, 0)
  const staleCount = rows.filter((r) => r.stale).length

  return (
    <div>
      <PageHeader
        title="Runners"
        subtitle="registered cluster nodes and their shard load"
      />
      <ErrorNote error={error} onRetry={refresh} />
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <SortableTh label="Address" sortKey="address" sort={sort} />
              <TH className="sticky top-0 z-10 bg-kumo-base">Host</TH>
              <TH className="sticky top-0 z-10 bg-kumo-base">Groups</TH>
              <SortableTh label="Version" sortKey="version" sort={sort} />
              <SortableTh label="Shards" sortKey="shards" sort={sort} className="text-right" />
              <TH className="sticky top-0 z-10 bg-kumo-base">Status</TH>
              <TH className="sticky top-0 z-10 bg-kumo-base">Load</TH>
            </TR>
          </THead>
          <TBody>
            {sort.sorted(rows).map((r) => (
              <TR key={r.address}>
                <TD className="font-medium">
                  {r.address}
                  {r.stale && (
                    <Badge tone="warn" className="ml-2">
                      stale
                    </Badge>
                  )}
                </TD>
                <TD className="text-kumo-subtle">
                  {r.host ?? "—"}
                  {r.port ? `:${r.port}` : ""}
                </TD>
                <TD>
                  <div className="flex gap-1">
                    {(r.groups.length > 0 ? r.groups : ["—"]).map((g) => (
                      <Badge key={g} tone="info">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </TD>
                <TD className="tabular-nums text-kumo-subtle">v{r.version ?? "?"}</TD>
                <TD className="text-right tabular-nums">{r.shards}</TD>
                <TD>
                  {r.stale ?
                    <Badge tone="warn">no shards</Badge> :
                    <Badge tone="ok">active</Badge>}
                </TD>
                <TD>
                  <LoadBar shards={r.shards} total={totalShards || 1} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {rows.length === 0 && (
          <Empty
            icon={<Cpu className="h-8 w-8 text-kumo-subtle" />}
            title="No runners registered"
            description="Runners appear in shard storage once a cluster node connects."
          />
        )}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-kumo-subtle">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-kumo-warning align-middle" />
        stale = registered in shard storage but currently owning zero shards — the
        runner is likely shut down or draining{staleCount > 0 ? ` (${staleCount} detected)` : ""}.
      </p>
    </div>
  )
}

function LoadBar({ shards, total }: { shards: number; total: number }) {
  return (
    <div className="h-2 w-32 overflow-hidden rounded-full border border-kumo-line bg-kumo-canvas">
      <div
        className="h-full bg-kumo-success transition-all"
        style={{ width: `${(shards / total) * 100}%` }}
      />
    </div>
  )
}
