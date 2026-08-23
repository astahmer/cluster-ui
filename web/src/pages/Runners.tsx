import * as React from "react"
import { api, type Runner } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"

export function RunnersPage() {
  const [rows, setRows] = React.useState<Runner[]>([])
  const { loading, error } = useLive(async () => setRows(await api.runners()))

  if (loading && rows.length === 0) return null
  const totalShards = rows.reduce((acc, r) => acc + r.shards, 0)
  const staleCount = rows.filter((r) => r.stale).length

  return (
    <div>
      <PageHeader
        title="Runners"
        subtitle="registered cluster nodes and their shard load"
      />
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
              <TH>Status</TH>
              <TH>Load</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.address}>
                <TD className="font-medium">
                  {r.address}
                  {r.stale && (
                    <Badge tone="warn" className="ml-2">
                      stale
                    </Badge>
                  )}
                </TD>
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
      </div>
      <p className="mt-2 text-[12px] text-muted">
        <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle bg-warn" />
        stale = registered in shard storage but currently owning zero shards — the
        runner is likely shut down or draining{staleCount > 0 ? ` (${staleCount} detected)` : ""}.
      </p>
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
