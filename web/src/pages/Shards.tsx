import * as React from "react"
import { api, type Shard } from "../api.ts"
import { Badge, Select, Table, TBody, TD, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { FilterChip, SkeletonTable, SortableTh, useHashParam, useSort } from "../components/pieces.tsx"
import { FilterBar, useFacets, type FacetDef } from "../components/filters/index.tsx"

type ShardFilter = "all" | "assigned" | "unassigned"

/* categorical per-runner hues (P1-14), revised per UX audit #2: hues spread
   around the wheel and lightness-tuned so adjacent slots stay distinguishable
   at 10px cells in BOTH light and dark modes (old set had 3 adjacent warms) */
const RUNNER_PALETTE = [
  "#0072b2", // blue
  "#e69f00", // amber orange
  "#009e73", // green
  "#cc79a7", // magenta
  "#56b4e9", // sky blue
  "#d55e00", // vermilion
  "#9467bd", // purple
  "#a3861a"  // darkened yellow (readable on white, still visible on dark)
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
  // legend + map reflect the ACTIVE filters (header Select AND facets) so e.g.
  // filtering to "unassigned" no longer paints every assigned cell (UX audit #2)
  const visibleRunners = [...new Set(filtered.filter((s) => s.address !== null).map((s) => s.address!))]
    .sort()
    .map((address) => ({ address, count: filtered.filter((s) => s.address === address).length }))
  // aggregate cells on huge shard counts so the grid stays renderable:
  // one cell represents `bucketSize` consecutive shards, colored by the first
  const BUCKET_THRESHOLD = 1024
  const bucketSize =
    filtered.length > BUCKET_THRESHOLD ? Math.ceil(filtered.length / BUCKET_THRESHOLD) : 1
  const buckets: Shard[][] = []
  for (let i = 0; i < filtered.length; i += bucketSize) buckets.push(filtered.slice(i, i + bucketSize))

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
          Distribution map{" "}
          {bucketSize > 1
            ? `— ${bucketSize} shards per cell (${buckets.length} cells)`
            : "— one cell per shard"}{filter !== "all" || facets.hasActive ? " · showing active filters only" : ""}
        </div>
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-kumo-subtle">
            no shards match the active filters
          </div>
        ) : (
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(10px, 1fr))" }}
        >
          {buckets.map((bucket) => {
            const first = bucket[0]
            const last = bucket[bucket.length - 1]
            const bucketRunners = [...new Set(bucket.map((shard) => shard.address).filter((address): address is string => address !== null))]
            const rangeLabel =
              bucketSize > 1 ? `shards ${first.shardId}–${last.shardId}` : `shard ${first.shardId}`
            const mixed = bucketRunners.length > 1
            return (
              <div
                key={first.shardId}
                title={`${rangeLabel} → ${first.address ?? "UNASSIGNED"}${mixed ? ` (${bucketRunners.length} runners in this bucket)` : ""}`}
                aria-label={
                  bucketSize > 1
                    ? `${rangeLabel}, ${mixed ? `${bucketRunners.length} runners` : `assigned to ${first.address ?? "nobody"}`}`
                    : `shard ${first.shardId} ${first.address ? `assigned to ${first.address}` : "unassigned"}`
                }
                className="aspect-square cursor-help rounded-[3px]"
                style={
                  first.address
                    ? mixed
                      ? { background: `linear-gradient(90deg, ${bucketRunners.map((address) => runnerHue(address)).join(", ")})`, opacity: 0.85 }
                      : { background: runnerHue(first.address), opacity: 0.85 }
                    : { background: "color-mix(in oklab, var(--color-kumo-warning) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-kumo-warning) 50%, transparent)" }
                }
              />
            )
          })}
        </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-kumo-subtle">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: "color-mix(in oklab, var(--color-kumo-warning) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-kumo-warning) 50%, transparent)" }}
            />{" "}
            unassigned (rebalancing)
          </span>
          {visibleRunners.map((r) => (
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
