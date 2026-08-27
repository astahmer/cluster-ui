import * as React from "react"
import { Cpu } from "@phosphor-icons/react"
import { api, type Runner } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { STICKY_TH } from "../components/pieces.tsx"
import { SkeletonTable, SortableTh, useSort } from "../components/pieces.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"

export function RunnersPage() {
  const [rows, setRows] = React.useState<Runner[]>([])
  const { loading, error, refresh } = useLive(async () => setRows(await api.runners()))
  const sort = useSort<Runner>()

  const facetDefs: FacetDef<Runner>[] = [
    {
      key: "group",
      label: "group",
      options: (all) => [...new Set(all.flatMap((r) => r.groups))].sort().map((g) => ({ value: g })),
      predicate: (r, v) => v.some((g) => r.groups.includes(g))
    },
    presenceFacet("stale", "stale", (r) => Boolean(r.stale))
  ]
  const facets = useFacets(rows, facetDefs)

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
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-kumo-subtle">
          <Badge tone={staleCount > 0 ? "warn" : "ok"}>{rows.length - staleCount}/{rows.length} assigned/active</Badge>
          <Badge tone="info">{totalShards} shard{totalShards === 1 ? "" : "s"}</Badge>
          {staleCount > 0 && <Badge tone="warn">{staleCount} no shard assignment</Badge>}
        </div>
      )}
      <FilterBar defs={facetDefs} rows={rows} facets={facets} />
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <SortableTh label="Address" sortKey="address" sort={sort} />
              <TH className={STICKY_TH}>Host</TH>
              <TH className={STICKY_TH}>Groups</TH>
              <SortableTh label="Version" sortKey="version" sort={sort} />
              <SortableTh label="Shards" sortKey="shards" sort={sort} className="text-right" />
              <TH className={STICKY_TH}>Status</TH>
              <TH className={STICKY_TH}>Load</TH>
            </TR>
          </THead>
          <TBody>
            {sort.sorted(facets.filtered).map((r) => (
              <TR key={r.address}>
                <TD className="font-medium">{r.address}</TD>
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
                    <Badge tone="warn">no shard assignment</Badge> :
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
        no shard assignment means the runner is registered but currently owns zero shards;
        this does not prove that its process is unhealthy. Check Runtime for reporter health.
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
