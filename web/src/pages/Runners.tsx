import * as React from "react"
import { api, type Runner } from "../api.ts"
import { Badge } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"

export function RunnersPage() {
  const [rows, setRows] = React.useState<Runner[]>([])
  const { loading, error } = usePolling(async () => setRows(await api.runners()))

  if (loading && rows.length === 0) return null
  const totalShards = rows.reduce((acc, r) => acc + r.shards, 0)

  return (
    <div>
      <PageHeader title="Runners" subtitle="registered cluster nodes and their shard load" />
      <ErrorNote error={error} />
      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Address</TH>
              <TH>Host</TH>
              <TH>Groups</TH>
              <TH>Version</TH>
              <TH className="text-right">Shards</TH>
              <TH>Load</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.address}>
                <TD className="font-medium">{r.address}</TD>
                <TD className="text-muted">
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
                <TD className="tabular-nums text-muted">v{r.version ?? "?"}</TD>
                <TD className="text-right tabular-nums">{r.shards}</TD>
                <TD>
                  <LoadBar shards={r.shards} total={totalShards || 1} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  )
}

function LoadBar({ shards, total }: { shards: number; total: number }) {
  return (
    <div className="h-2 w-32 overflow-hidden rounded-full bg-bg border border-border">
      <div
        className="h-full bg-ok transition-all"
        style={{ width: `${(shards / total) * 100}%` }}
      />
    </div>
  )
}
