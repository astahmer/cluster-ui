import * as React from "react"
import { api, type EntityStat } from "../api.ts"
import { ActivityDot } from "../components/pieces.tsx"
import { Badge, Input, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"

export function EntitiesPage() {
  const [rows, setRows] = React.useState<EntityStat[]>([])
  const [q, setQ] = React.useState("")
  const { loading, error } = usePolling(async () => setRows(await api.entities()))

  if (loading && rows.length === 0) return null
  const filtered = rows.filter((r) => r.entityType.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <PageHeader title="Entities" subtitle="message activity grouped by entity type">
        <Input
          placeholder="filter types…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
      </PageHeader>
      <ErrorNote error={error} />
      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Entity type</TH>
              <TH className="text-right">Entities</TH>
              <TH className="text-right">Messages</TH>
              <TH className="text-right">Pending</TH>
              <TH className="text-right">In-flight</TH>
              <TH className="text-right">Scheduled</TH>
              <TH className="text-right">Done</TH>
              <TH>Last activity</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => {
              const isWorkflow = r.entityType.startsWith("Workflow/")
              const name = isWorkflow ? r.entityType.slice("Workflow/".length) : r.entityType
              return (
                <TR key={r.entityType}>
                  <TD>
                    {isWorkflow ? (
                      <a
                        href={`#/workflows/${encodeURIComponent(name)}`}
                        className="font-medium text-text hover:text-accent"
                      >
                        {name} <Badge tone="info" className="ml-1.5">workflow</Badge>
                      </a>
                    ) : (
                      <code className="font-medium">{r.entityType}</code>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{r.entities}</TD>
                  <TD className="text-right tabular-nums">{r.messages}</TD>
                  <TD className="text-right tabular-nums">
                    {r.pending > 0 ? <Badge tone="warn">{r.pending}</Badge> : <span className="text-muted">0</span>}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {r.inflight > 0 ? <Badge tone="info">{r.inflight}</Badge> : <span className="text-muted">0</span>}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {r.scheduled > 0 ? <Badge tone="accent">{r.scheduled}</Badge> : <span className="text-muted">0</span>}
                  </TD>
                  <TD className="text-right tabular-nums text-muted">{r.done}</TD>
                  <TD>
                    <ActivityDot at={r.lastActivityAt} />
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </div>
    </div>
  )
}
