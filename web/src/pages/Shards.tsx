import * as React from "react"
import { api, type Shard } from "../api.ts"
import { Badge, Select, Table, TBody, TD, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { FilterChip, SkeletonTable, SortableTh, useHashParam, useSort } from "../components/pieces.tsx"

type ShardFilter = "all" | "assigned" | "unassigned"

export function ShardsPage() {
  const [shards, setShards] = React.useState<Shard[]>([])
  const [filterParam, setFilterParam] = useHashParam("filter")
  const filter = (filterParam === "assigned" || filterParam === "unassigned" ? filterParam : "all") as ShardFilter
  const setFilter = (v: string) => setFilterParam(v === "all" ? "" : v)
  const { loading, error, refresh } = usePolling(async () => setShards(await api.shards()))
  const sort = useSort<Shard>()

  if (loading && shards.length === 0) return <SkeletonTable />
  const filtered = shards.filter((s) =>
    filter === "all" ? true : filter === "assigned" ? s.address !== null : s.address === null
  )
  const assignedCount = shards.filter((s) => s.address !== null).length

  return (
    <div>
      <PageHeader title="Shards">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All ({shards.length})</option>
          <option value="assigned">Assigned ({assignedCount})</option>
          <option value="unassigned">Unassigned ({shards.length - assignedCount})</option>
        </Select>
      </PageHeader>
      {filter !== "all" && (
        <div className="mb-2">
          <FilterChip label={`filter: ${filter}`} onRemove={() => setFilter("")} />
        </div>
      )}
      <ErrorNote error={error} onRetry={refresh} />
      <div className="mb-4 rounded-lg border border-kumo-line bg-kumo-base p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
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
              aria-label={`shard ${s.shardId} ${s.address ? `assigned to ${s.address}` : "unassigned"}`}
              className={
                "aspect-square cursor-help rounded-[3px] " +
                (s.address
                  ? "bg-(--color-kumo-brand)/80"
                  : "border border-kumo-warning/50 bg-kumo-warning/10")
              }
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[12px] text-kumo-subtle">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-(--color-kumo-brand)/80" /> assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-kumo-warning/50 bg-kumo-warning/10" />{" "}
            unassigned (rebalancing)
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <SortableTh label="Shard" sortKey="shardId" sort={sort} />
              <SortableTh label="Assigned runner" sortKey="address" sort={sort} />
            </TR>
          </THead>
          <TBody>
            {sort.sorted(filtered).map((s) => (
              <TR key={s.shardId}>
                <TD className="tabular-nums">{s.shardId}</TD>
                <TD>
                  {s.address ? (
                    <span>{s.address}</span>
                  ) : (
                    <Badge tone="warn">unassigned</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {filtered.length === 0 && (
          <div className="py-8 text-center text-[13px] text-kumo-subtle">no shards match</div>
        )}
      </div>
    </div>
  )
}
