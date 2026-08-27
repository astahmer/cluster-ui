import * as React from "react"
import { api, type EntityInstance } from "../api.ts"
import { ActivityDot, Pager, ScheduledBadge, SkeletonTable, rowInteractions, useHashParam } from "../components/pieces.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { Badge, Button, Input, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { Breadcrumbs, ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { Empty } from "../kumo"
import { useExport } from "../export.ts"

function messagesHref(entityType: string, entityId: string): string {
  const params = new URLSearchParams({
    entityType,
    entityId,
    returnTo: "/entities/" + encodeURIComponent(entityType),
    returnLabel: "back to entity instances"
  })
  return "#/messages?" + params.toString()
}

export function EntityInstancesPage({ entityType }: { entityType: string }) {
  const [rows, setRows] = React.useState<EntityInstance[]>([])
  const [total, setTotal] = React.useState(0)
  const [q, setQ] = useHashParam("q")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [pageParam, setPageParam] = useHashParam("page")
  const page = Math.max(1, Number.parseInt(pageParam || "1", 10) || 1)
  const setPage = (next: number) => setPageParam(next <= 1 ? "" : String(next))
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
      <Breadcrumbs items={[{ label: "Entities", href: "#/entities" }, { label: entityType }]} />
      <PageHeader
        title={entityType}
        subtitle={total > 0 ? `${total.toLocaleString()} instances` : "entity instances"}
      >
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
              <TH className="hidden text-right sm:table-cell">Messages</TH>
              <TH className="text-right">Pending</TH>
              <TH className="hidden text-right md:table-cell">In-flight</TH>
              <TH className="hidden text-right md:table-cell">Scheduled</TH>
              <TH className="hidden text-right md:table-cell">Done</TH>
              <TH className="text-right">Failed</TH>
              <TH className="hidden sm:table-cell">Last activity</TH>
            </TR>
          </THead>
          <TBody>
            {(loading && rows.length === 0 ? [] : facets.filtered).map((r) => (
              <TR
                key={r.entityId}
                className="cursor-pointer"
                {...rowInteractions(() =>
                  (window.location.hash = messagesHref(entityType, r.entityId))
                )}
              >
                <TD className="font-mono text-xs">{r.entityId}</TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{r.total}</TD>
                <TD className="text-right tabular-nums">
                  {r.pending > 0 ? <Badge tone="warn">{r.pending}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="hidden text-right tabular-nums md:table-cell">
                  {r.inflight > 0 ? <Badge tone="info">{r.inflight}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="hidden text-right tabular-nums md:table-cell">
                  {r.scheduled > 0 ? <ScheduledBadge count={r.scheduled} /> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="hidden text-right tabular-nums text-kumo-subtle md:table-cell">{r.done}</TD>
                <TD className="text-right tabular-nums">
                  {r.failed > 0 ? <Badge tone="err">{r.failed}</Badge> : <span className="text-kumo-subtle">0</span>}
                </TD>
                <TD className="hidden sm:table-cell">
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
