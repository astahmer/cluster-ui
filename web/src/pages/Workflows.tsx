import * as React from "react"
import { api, type MessageStatus, type Workflow, type WorkflowRun } from "../api.ts"
import { ActivityDot, FilterChip, SkeletonTable, SortableTh, STICKY_TH, useHashParam, useSort } from "../components/pieces.tsx"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { Badge, Card, CardContent, Select, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { usePauseWhile } from "../live.ts"
import { StatusBadge } from "../components/pieces.tsx"
import { Empty } from "../kumo"
import { WorkflowRunPage } from "./WorkflowRunDetail.tsx"

/** server rows also carry `failed` (Failure WithExit reply on the run message) */
type RunRow = WorkflowRun & { failed?: boolean }

type WorkflowSort = "name" | "runs" | "failedRuns"

export function WorkflowListPage() {
  const [rows, setRows] = React.useState<Workflow[]>([])
  const [sortByParam, setSortByParam] = useHashParam("sort")
  const sortBy = (["name", "runs", "failedRuns"].includes(sortByParam) ? sortByParam : "name") as WorkflowSort
  const { loading, error, refresh } = useLive(async () => setRows(await api.workflows()))

  const facetDefs: FacetDef<Workflow>[] = [
    {
      key: "failures",
      label: "failures",
      options: () => [
        { value: "yes", label: "with failures" },
        { value: "no", label: "all healthy" }
      ],
      predicate: (w, v) => v.includes((w.failedRuns ?? 0) > 0 ? "yes" : "no")
    }
  ]
  const facets = useFacets(rows, facetDefs)

  if (loading && rows.length === 0) return <SkeletonTable rows={6} cols={4} />
  const totalRuns = rows.reduce((acc, w) => acc + w.runs, 0)
  const totalFailed = rows.reduce((acc, w) => acc + (w.failedRuns ?? 0), 0)
  const sortedRows =
    sortBy === "name" ?
      [...rows].sort((a, b) => a.name.localeCompare(b.name)) :
      [...rows].sort((a, b) =>
        sortBy === "runs" ? b.runs - a.runs : (b.failedRuns ?? 0) - (a.failedRuns ?? 0)
      )

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle={`${totalRuns} executions across ${rows.length} workflows`}
      >
        <Select aria-label="sort workflows" value={sortBy} onChange={(e) => setSortByParam(e.target.value === "name" ? "" : e.target.value)}>
          <option value="name">by name</option>
          <option value="runs">most runs</option>
          <option value="failedRuns">most failed</option>
        </Select>
      </PageHeader>
      {sortBy !== "name" && (
        <div className="mb-2">
          <FilterChip label={`sort: ${sortBy === "runs" ? "most runs" : "most failed"}`} onRemove={() => setSortByParam("")} />
        </div>
      )}
      <FilterBar defs={facetDefs} rows={rows} facets={facets} />
      <ErrorNote error={error} onRetry={refresh} />
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <Empty
              title="No workflows yet"
              description="Workflows appear here once a ClusterWorkflowEngine executes them — look for entity types named Workflow/<name>."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sortedRows.map((w) => (
            <Card key={w.name} className="transition-colors hover:border-kumo-brand/60">
              <a href={`#/workflows/${encodeURIComponent(w.name)}`} className="block">
                <div className="flex items-center justify-between px-4 pt-3">
                  <span className="font-semibold">{w.name}</span>
                  <ActivityDot at={w.lastActivityAt} />
                </div>
                <div className="flex items-center gap-2 px-4 py-3 text-[13px]">
                  <Badge tone="ok">{w.completedRuns} completed</Badge>
                  {w.activeRuns > 0 && <Badge tone="warn">{w.activeRuns} active</Badge>}
                  {(w.failedRuns ?? 0) > 0 && (
                    <Badge tone="err">{w.failedRuns} failed</Badge>
                  )}
                  <span className="ml-auto text-kumo-subtle tabular-nums">
                    {w.runs} runs
                    {totalFailed > 0 && (w.failedRuns ?? 0) > 0 ?
                      ` · ${Math.round(((w.failedRuns ?? 0) / w.runs) * 100)}% fail rate` :
                      ""}
                  </span>
                </div>
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

const RUN_STATUSES = ["pending", "inflight", "scheduled", "done"] as const

export function WorkflowRunsPage({
  name,
  executionId: executionIdProp
}: {
  name: string
  /** deep link #/workflows/<name>/<executionId> — the run modal hydrates from this */
  executionId?: string
}) {
  const [runs, setRuns] = React.useState<RunRow[] | null>(null)
  const [openExecution, setOpenExecutionState] = React.useState<string | null>(
    executionIdProp ?? null
  )

  // open/close writes the hash so the run modal is an addressable URL (UX review P1-1)
  const setOpenExecution = React.useCallback(
    (exec: string | null) => {
      setOpenExecutionState(exec)
      const raw = window.location.hash.slice(1) || `/workflows/${encodeURIComponent(name)}`
      const qIdx = raw.indexOf("?")
      const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1))
      const qs = params.toString()
      window.location.hash = `/workflows/${encodeURIComponent(name)}${
        exec !== null ? `/${encodeURIComponent(exec)}` : ""
      }${qs ? `?${qs}` : ""}`
    },
    [name]
  )
  React.useEffect(() => {
    setOpenExecutionState(executionIdProp ?? null)
  }, [executionIdProp])
  const [statusParam, setStatusParam] = useHashParam("status")
  const statusFilter = RUN_STATUSES.includes(statusParam as never) ? statusParam : ""
  const { loading, error, refresh } = useLive(async () =>
    setRuns((await api.workflowRuns(name)) as RunRow[])
  )
  // stop background polling while the run-detail panel is open so it doesn't rerender under the cursor
  usePauseWhile(openExecution !== null)
  const sort = useSort<RunRow>()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const facetDefs: FacetDef<RunRow>[] = [
    // status filtering lives in the header <Select> (URL-backed `?status=`) —
    // a client facet here would duplicate it in two places (UX review P1-13)
    presenceFacet("failed", "failed", (r) => Boolean((r as RunRow).failed))
  ]
  const facets = useFacets(runs ?? [], facetDefs)

  if (loading && runs === null) return <SkeletonTable rows={8} cols={4} />

  const visibleRuns = facets.filtered.filter(
    (r) => !statusFilter || r.status === statusFilter
  )

  return (
    <div>
      <FilterBar defs={facetDefs} rows={runs ?? []} facets={facets} />
      <PageHeader title={name} subtitle="workflow executions">
        <a href="#/workflows" className="text-[13px] text-kumo-subtle hover:text-kumo-default">
          ← all workflows
        </a>
        <Select
          aria-label="filter by status"
          value={statusFilter}
          onChange={(e) => setStatusParam(e.target.value)}
        >
          <option value="">all statuses</option>
          {RUN_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </Select>
      </PageHeader>
      {(statusFilter || sort.sortKey !== null) && (
        <div className="mb-2 flex items-center gap-1.5">
          {statusFilter && <FilterChip label={`status: ${statusFilter}`} onRemove={() => setStatusParam("")} />}
          {sort.sortKey !== null && (
            <FilterChip
              label={`sort: ${sort.sortKey} ${sort.dir === "asc" ? "▲" : "▼"}`}
              onRemove={() => sort.toggle(sort.sortKey!)}
            />
          )}
        </div>
      )}
      <ErrorNote error={error} onRetry={refresh} />
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <SortableTh label="Execution" sortKey="executionId" sort={sort} />
              <TH className={STICKY_TH}>Status</TH>
              <SortableTh label="Activities" sortKey="activityCount" sort={sort} className="text-right" />
              <SortableTh label="Started" sortKey="createdAt" sort={sort} />
            </TR>
          </THead>
          <TBody>
            {sort.sorted(visibleRuns).map((r) => (
              <TR
                key={r.executionId}
                className={
                  "cursor-pointer" +
                  (r.failed ? " border-l-2 border-l-kumo-danger hover:bg-kumo-danger/5" : "")
                }
                onClick={() => setOpenExecution(r.executionId)}
              >
                <TD
                  className={
                    "font-mono text-xs " + (r.failed ? "text-kumo-danger" : "")
                  }
                >
                  {r.executionId}
                  {r.failed && (
                    <Badge tone="err" className="ml-2">
                      failed
                    </Badge>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={r.status as MessageStatus} />
                </TD>
                <TD className="tabular-nums text-kumo-subtle">{r.activityCount}</TD>
                <TD className="whitespace-nowrap text-kumo-subtle">
                  {new Date(r.createdAt).toLocaleString()}
                </TD>
              </TR>
            ))}
            {!error && runs !== null && visibleRuns.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-6">
                  <Empty title={statusFilter ? "no executions match the filter" : "No executions"} />
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      {openExecution && (
        <WorkflowRunDetailModal
          name={name}
          executionId={openExecution}
          onClose={() => setOpenExecution(null)}
          onChanged={() => {
            api
              .workflowRuns(name)
              .then((r) => setRuns(r as RunRow[]))
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}

function WorkflowRunDetailModal({
  name,
  executionId,
  onClose,
  onChanged
}: {
  name: string
  executionId: string
  onClose: () => void
  onChanged?: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-kumo-line bg-kumo-base p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {name} <span className="font-mono text-xs text-kumo-subtle">/ {executionId}</span>
          </h2>
          <button
            className="cursor-pointer rounded px-2 py-1 text-[12px] text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
            onClick={onClose}
          >
            ✕ close
          </button>
        </div>
        <WorkflowRunPage name={name} executionId={executionId} onChanged={onChanged} />
      </div>
    </div>
  )
}
