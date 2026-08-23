import * as React from "react"
import { api, type Shard } from "../api.ts"
import { Badge, Select } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"

export function ShardsPage() {
  const [shards, setShards] = React.useState<Shard[]>([])
  const [filter, setFilter] = React.useState<"all" | "assigned" | "unassigned">("all")
  const { loading, error } = usePolling(async () => setShards(await api.shards()))

  if (loading && shards.length === 0) return null
  const filtered = shards.filter((s) =>
    filter === "all" ? true : filter === "assigned" ? s.address !== null : s.address === null
  )
  // group consecutive shard ids per runner for a compact heat strip
  const assignedCount = shards.filter((s) => s.address !== null).length

  return (
    <div>
      <PageHeader title="Shards">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All ({shards.length})</option>
          <option value="assigned">Assigned ({assignedCount})</option>
          <option value="unassigned">Unassigned ({shards.length - assignedCount})</option>
        </Select>
      </PageHeader>
      <ErrorNote error={error} />
      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Distribution map — one cell per shard
        </div>
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(10px, 1fr))" }}
        >
          {shards.map((s) => (
            <div
              key={s.shardId}
              title={`shard ${s.shardId} → ${s.address ?? "UNASSIGNED"}`}
              className={
                "aspect-square cursor-help rounded-[3px] " +
                (s.address ? "bg-accent/80" : "border border-warn/50 bg-warn/10")
              }
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent/80" /> assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-warn/50 bg-warn/10" /> unassigned
            (rebalancing)
          </span>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted">
              <th>Shard</th>
              <th>Assigned runner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.shardId} className="border-t border-border/60 hover:bg-surface-2/60">
                <td className="px-3 py-1.5 tabular-nums">{s.shardId}</td>
                <td className="px-3 py-1.5">
                  {s.address ? (
                    <span>{s.address}</span>
                  ) : (
                    <Badge tone="warn">unassigned</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
