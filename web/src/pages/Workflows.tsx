import * as React from "react"
import { api, type MessageStatus, type Workflow, type WorkflowRun } from "../api.ts"
import { ActivityDot } from "../components/pieces.tsx"
import { Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { StatusBadge } from "../components/pieces.tsx"
import { Empty } from "../kumo"
import { WorkflowRunPage } from "./WorkflowRunDetail.tsx"

/** server rows also carry `failed` (Failure WithExit reply on the run message) */
type RunRow = WorkflowRun & { failed?: boolean }

export function WorkflowListPage() {
  const [rows, setRows] = React.useState<Workflow[]>([])
  const { loading, error } = useLive(async () => setRows(await api.workflows()))

  if (loading && rows.length === 0) return null
  const totalRuns = rows.reduce((acc, w) => acc + w.runs, 0)
  const totalFailed = rows.reduce((acc, w) => acc + (w.failedRuns ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle={`${totalRuns} executions across ${rows.length} workflows`}
      />
      <ErrorNote error={error} />
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
          {rows.map((w) => (
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

export function WorkflowRunsPage({ name }: { name: string }) {
  const [runs, setRuns] = React.useState<RunRow[] | null>(null)
  const [openExecution, setOpenExecution] = React.useState<string | null>(null)
  const { error } = useLive(async () =>
    setRuns((await api.workflowRuns(name)) as RunRow[])
  )

  return (
    <div>
      <PageHeader title={name} subtitle="workflow executions">
        <a href="#/workflows" className="text-[13px] text-kumo-subtle hover:text-kumo-default">
          ← all workflows
        </a>
      </PageHeader>
      <ErrorNote error={error} />
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Execution</TH>
              <TH>Status</TH>
              <TH>Activities</TH>
              <TH>Started</TH>
            </TR>
          </THead>
          <TBody>
            {(runs ?? []).map((r) => (
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
            {!error && runs !== null && runs.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-6">
                  <Empty title="No executions" />
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
