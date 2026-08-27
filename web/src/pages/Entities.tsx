import * as React from "react"
import { api, type EntityStat } from "../api.ts"
import {
  ActivityDot,
  FilterChip,
  ScheduledBadge,
  SkeletonTable,
  SortableTh,
  STICKY_TH,
  useHashParam,
  useSort
} from "../components/pieces.tsx"
import { Badge, Button, Input, Table, TBody, TD, THead, TR } from "../components/ui.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { useExport } from "../export.ts"

export function EntitiesPage() {
  const [rows, setRows] = React.useState<EntityStat[]>([])
  const [q, setQ] = useHashParam("q")
  const { loading, error, refresh } = usePolling(async () => setRows(await api.entities()))
  const sort = useSort<EntityStat>(null, {
    urlKey: "sort",
    allowedKeys: ["entityType", "entities", "messages", "pending", "inflight", "scheduled", "done", "lastActivityAt"]
  })

  const facetDefs: FacetDef<EntityStat>[] = [
    {
      key: "activity",
      label: "activity",
      options: () => [
        { value: "active", label: "active now (pending/in-flight)" },
        { value: "quiet", label: "quiet" }
      ],
      predicate: (r, v) => v.includes(r.pending + r.inflight > 0 ? "active" : "quiet")
    },
    presenceFacet("hasScheduled", "scheduled", (r) => r.scheduled > 0),
    presenceFacet("hasInflight", "in-flight", (r) => r.inflight > 0),
  ]
  const facets = useFacets(rows, facetDefs)

  const qLower = q.toLowerCase()
  const filtered = facets.filtered.filter(
    (r) => qLower === "" || r.entityType.toLowerCase().includes(qLower)
  )
  const sorted = sort.sorted(filtered)
  // hooks must run unconditionally (early return below would break the rules of hooks)
  const exportRows = React.useMemo(
    () =>
      sorted.map((r) => ({
        entityType: r.entityType,
        entities: r.entities,
        messages: r.messages,
        pending: r.pending,
        inflight: r.inflight,
        scheduled: r.scheduled,
        done: r.done
      })),
    [sorted]
  )
  const exporters = useExport(exportRows, "entities")

  if (loading && rows.length === 0) return <SkeletonTable />

  return (
    <div>
      <PageHeader title="Entities" subtitle="message activity grouped by entity type">
        <Input
          aria-label="filter entity types"
          placeholder="filter types…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
          data-search-input
        />
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={exportRows.length === 0} onClick={exporters.json}>
            export page (json)
          </Button>
          <Button variant="ghost" size="sm" disabled={exportRows.length === 0} onClick={exporters.csv}>
            export page (csv)
          </Button>
        </span>
      </PageHeader>
      <FilterBar defs={facetDefs} rows={rows} facets={facets} />
      <ErrorNote error={error} onRetry={refresh} />
      {(q !== "" || sort.sortKey !== null) && (
        <div className="mb-2 flex items-center gap-1.5">
          {q !== "" && <FilterChip label={`type: ${q}`} onRemove={() => setQ("")} />}
          {sort.sortKey !== null && (
            <FilterChip
              label={`sort: ${sort.sortKey} ${sort.dir === "asc" ? "▲" : "▼"}`}
              onRemove={() => sort.toggle(sort.sortKey!)}
            />
          )}
        </div>
      )}
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <SortableTh label="Entity type" sortKey="entityType" sort={sort} />
              <SortableTh label="Entities" sortKey="entities" sort={sort} className="text-right" />
              <SortableTh label="Messages" sortKey="messages" sort={sort} className="text-right" />
              <SortableTh label="Pending" sortKey="pending" sort={sort} className="text-right" />
              <SortableTh label="In-flight" sortKey="inflight" sort={sort} className="text-right" />
              <SortableTh label="Scheduled" sortKey="scheduled" sort={sort} className="text-right" />
              <SortableTh label="Done" sortKey="done" sort={sort} className="text-right" />
              <SortableTh label="Last activity" sortKey="lastActivityAt" sort={sort} />
            </TR>
          </THead>
          <TBody>
            {sorted.map((r) => {
              const isWorkflow = r.entityType.startsWith("Workflow/")
              const isCron = r.entityType.startsWith("ClusterCron/")
              const name = isWorkflow ? r.entityType.slice("Workflow/".length) : r.entityType
              return (
                <TR key={r.entityType}>
                  <TD>
                    {isWorkflow ? (
                      <a
                        href={`#/workflows/${encodeURIComponent(name)}`}
                        className="font-medium text-kumo-default hover:text-kumo-link"
                      >
                        {name} <Badge tone="info" className="ml-1.5">workflow</Badge>
                      </a>
                    ) : isCron ? (
                      <a
                        href={`#/crons`}
                        className="font-medium text-kumo-default hover:text-kumo-link"
                      >
                        {r.entityType} <Badge tone="accent" className="ml-1.5">cron</Badge>
                      </a>
                    ) : (
                      <a
                        href={`#/entities/${encodeURIComponent(r.entityType)}`}
                        className="font-medium text-kumo-default hover:text-kumo-link"
                        title="view entity instances"
                      >
                        <code>{r.entityType}</code>
                      </a>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{r.entities}</TD>
                  <TD className="text-right tabular-nums">{r.messages}</TD>
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
