import * as React from "react"
import { api, type EntityInstance } from "../api.ts"
import { ActivityDot, SkeletonTable } from "../components/pieces.tsx"
import { Badge, Button, Input, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { Empty } from "../kumo"

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
      setRows(res.rows)
      setTotal(res.total)
    },
    [entityType, debouncedQ, page, pageSize]
  )

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
          placeholder="filter instance ids…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
          data-search-input
        />
      </PageHeader>
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
            {(loading && rows.length === 0 ? [] : rows).map((r) => (
              <TR
                key={r.entityId}
                className="cursor-pointer"
                onClick={() =>
                  (window.location.hash = `#/messages?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(r.entityId)}`)
                }
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
                  {r.scheduled > 0 ? <Badge tone="accent">{r.scheduled}</Badge> : <span className="text-kumo-subtle">0</span>}
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

      <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-kumo-subtle">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ← prev
        </Button>
        <span className="tabular-nums">page {page}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page * pageSize >= total}
          onClick={() => setPage(page + 1)}
        >
          next →
        </Button>
      </div>
    </div>
  )
}
