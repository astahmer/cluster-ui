import * as React from "react"
import { api, type EntityInstance } from "../api.ts"
import { ActivityDot, ScheduledBadge, SkeletonTable, rowInteractions, Pager } from "../components/pieces.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { Badge, Button, Input, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { Empty } from "../kumo"
import { useExport } from "../export.ts"

export function EntityInstancesPage({ entityType }: { entityType: string }) {
  const [rows, setRows] = React.useState<EntityInstance[]>([])
  const [total, setTotal] = React.useState(0)
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [page, setPage] = React.useState(1)
  const pageSize = 50

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const { loading, error, refresh } = usePolling(
    async () => {
      const res = await api.entityInstances({ entityType, q: debouncedQ || undefined, page, pageSize })
      setRows(Array.isArray(res.rows) ? res.rows : [])
      setTotal(res.total)
    },
    [entityType, debouncedQ, page, pageSize]
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const facetDefs: FacetDef<EntityInstance>[] = [
    presenceFacet("failed", "with failures", (r) => r.failed > 0),
    presenceFacet("pending", "currently pending", (r) => r.pending > 0)
  ]
  const facets = useFacets(rows, facetDefs)
  const exportRows = React.useMemo(
    () =>
      facets.filtered.map((r) => ({
        entityId: r.entityId,
        total: r.total,
        pending: r.pending,
        inflight: r.inflight,
        scheduled: r.scheduled,
        done: r.done,
        failed: r.failed
      })),
    [facets.filtered]
  )
  const exporters = useExport(exportRows, `${entityType}-instances`)

  if (loading && rows.length === 0) return <SkeletonTable rows={10} cols={4} />

  return (
    <div>
      <PageHeader
        title={entityType}
        subtitle={total > 0 ? `${total.toLocaleString()} instances` : "entity instances"}
      >
        <a href="#/entities" className="text-[13px] text-kumo-subtle hover:text-kumo-default">
          ← all entity types
        </a>
        <Input
          aria-label="filter instance ids"
          placeholder="filter instance ids…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
          data-search-input
        />
      </PageHeader>
      {/* A1: facet machinery existed but the bar was never rendered */}
      <FilterBar defs={facetDefs} rows={rows} facets={facets} />
      <div className="mb-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={exporters.json}>
          export page (json)
        </Button>
        <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={exporters.csv}>
          export page (csv)
        </Button>
      </div>
      <ErrorNote error={error} onRetry={refresh} />

      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Entity id</TH>
              <TH className="text-right">Messages</TH>
              <TH className="text-right">Pending</TH>
              <TH className="text-right">In-flight</TH>
              <TH className="text-right">Scheduled</TH>
              <TH className="text-right">Done</TH>
              <TH className="text-right">Failed</TH>
              <TH>Last activity</TH>
            </TR>
          </THead>
          <TBody>
            {(loading && rows.length === 0 ? [] : facets.filtered).map((r) => (
              <TR
                key={r.entityId}
                className="cursor-pointer"
                {...rowInteractions(() =>
                  (window.location.hash = `#/messages?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(r.entityId)}`)
                )}
              >
                <TD className="font-mono text-xs">{r.entityId}</TD>
                <TD className="text-right tabular-nums">{r.total}</TD>
                <TD className="text-right tabular-nums">
                  {r.pending > 0 ? <Badge tone="warn">{r.pending}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.inflight > 0 ? <Badge tone="info">{r.inflight}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.scheduled > 0 ? <ScheduledBadge count={r.scheduled} /> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="text-right tabular-nums text-kumo-subtle">{r.done}</TD>
                <TD className="text-right tabular-nums">
                  {r.failed > 0 ? <Badge tone="err">{r.failed}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD>
                  <ActivityDot at={r.lastActivityAt} />
                </TD>
              </TR>
            ))}
            {!loading && rows.length === 0 && (
              <TR>
                <TD colSpan={8} className="py-6">
                  <Empty title="No instances match" description="Try a different id filter." />
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} />
    </div>
  )
}
