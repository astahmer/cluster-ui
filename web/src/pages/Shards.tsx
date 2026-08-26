import * as React from "react"
import { api, type Shard } from "../api.ts"
import { Badge, Select, Table, TBody, TD, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { FilterChip, SkeletonTable, SortableTh, useHashParam, useSort } from "../components/pieces.tsx"
import { FilterBar, useFacets, type FacetDef } from "../components/filters/index.tsx"

type ShardFilter = "all" | "assigned" | "unassigned"

/* categorical per-runner hues (P1-14): stable hash → palette slot */
const RUNNER_PALETTE = [
  "#d95f6e", "#e08b3c", "#b99a24", "#63a24e",
  "#3aa88f", "#4299c9", "#7b7bd6", "#ad5cc9"
]
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
const runnerHue = (address: string) => RUNNER_PALETTE[hashString(address) % RUNNER_PALETTE.length]

export function ShardsPage() {
  const [shards, setShards] = React.useState<Shard[]>([])
  const [filterParam, setFilterParam] = useHashParam("filter")
  const filter = (filterParam === "assigned" || filterParam === "unassigned" ? filterParam : "all") as ShardFilter
  const setFilter = (v: string) => setFilterParam(v === "all" ? "" : v)
  const { loading, error, refresh } = usePolling(async () => setShards(await api.shards()))
  const sort = useSort<Shard>()

  const facetDefs: FacetDef<Shard>[] = [
    {
      key: "assignment",
      label: "assignment",
      options: () => [
        { value: "assigned", label: "assigned" },
        { value: "unassigned", label: "unassigned" }
      ],
      predicate: (shard, v) =>
        v.includes(shard.address !== null ? "assigned" : "unassigned")
    }
  ]
  const facets = useFacets(shards, facetDefs)

  if (loading && shards.length === 0) return <SkeletonTable />
  const filtered = facets.filtered.filter((s) =>
    filter === "all" ? true : filter === "assigned" ? s.address !== null : s.address === null
  )
  const assignedCount = shards.filter((s) => s.address !== null).length
  // per-runner counts for the map legend (P1-14)
  const runners = [...new Set(shards.filter((s) => s.address !== null).map((s) => s.address!))]
    .sort()
    .map((address) => ({ address, count: shards.filter((s) => s.address === address).length }))

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
          <FilterChip label={`filter: ${filter}`} onRemove={() => setFilter("all")} />
        </div>
      )}
      <FilterBar defs={facetDefs} rows={shards} facets={facets} />
      <ErrorNote error={error} onRetry={refresh} />
      <div className="mb-4 rounded-lg border border-kumo-line bg-kumo-base p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          Distribution map — one cell per shard, colored by runner
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
              className="aspect-square cursor-help rounded-[3px]"
              style={
                s.address
                  ? { background: runnerHue(s.address), opacity: 0.85 }
                  : { background: "color-mix(in oklab, var(--color-kumo-warning) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-kumo-warning) 50%, transparent)" }
              }
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-kumo-subtle">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: "color-mix(in oklab, var(--color-kumo-warning) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-kumo-warning) 50%, transparent)" }}
            />{" "}
            unassigned (rebalancing)
          </span>
          {runners.map((r) => (
            <span key={r.address} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: runnerHue(r.address), opacity: 0.85 }} />
              {r.address} · {r.count} shard{r.count === 1 ? "" : "s"}
            </span>
          ))}
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
