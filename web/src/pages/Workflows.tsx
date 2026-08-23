import * as React from "react"
import { api, type MessageStatus, type Workflow, type WorkflowRun } from "../api.ts"
import { ActivityDot } from "../components/pieces.tsx"
import { Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"
import { StatusBadge } from "../components/pieces.tsx"
import { WorkflowRunPage } from "./WorkflowRunDetail.tsx"

export function WorkflowListPage() {
  const [rows, setRows] = React.useState<Workflow[]>([])
  const { loading, error } = usePolling(async () => setRows(await api.workflows()))

  if (loading && rows.length === 0) return null
  const totalRuns = rows.reduce((acc, w) => acc + w.runs, 0)

  return (
    <div>
      <PageHeader title="Workflows" subtitle={`${totalRuns} executions across ${rows.length} workflows`} />
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted">
            No workflow runs recorded. Workflows appear here once a ClusterWorkflowEngine executes
            them — look for entity types named <code>Workflow/&lt;name&gt;</code>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((w) => (
            <Card key={w.name} className="transition-colors hover:border-accent/50">
              <a href={`#/workflows/${encodeURIComponent(w.name)}`} className="block">
                <div className="flex items-center justify-between px-4 pt-3">
                  <span className="font-semibold">{w.name}</span>
                  <ActivityDot at={w.lastActivityAt} />
                </div>
                <div className="flex items-center gap-2 px-4 py-3 text-[13px]">
                  <Badge tone="ok">{w.completedRuns} completed</Badge>
                  {w.activeRuns > 0 && <Badge tone="warn">{w.activeRuns} active</Badge>}
                  <span className="ml-auto text-muted tabular-nums">{w.runs} runs</span>
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
  const [runs, setRuns] = React.useState<WorkflowRun[] | null>(null)
  const [openExecution, setOpenExecution] = React.useState<string | null>(null)
  const { error } = usePolling(async () => setRuns(await api.workflowRuns(name)))

  return (
    <div>
      <PageHeader title={name} subtitle="workflow executions">
        <a
          href="#/workflows"
          className="text-[13px] text-muted hover:text-text"
        >
          ← all workflows
        </a>
      </PageHeader>
      <ErrorNote error={error} />
      <div className="rounded-lg border border-border bg-surface">
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
                className="cursor-pointer"
                onClick={() => setOpenExecution(r.executionId)}
              >
                <TD className="font-mono text-xs">{r.executionId}</TD>
                <TD>
                  <StatusBadge status={r.status as MessageStatus} />
                </TD>
                <TD className="tabular-nums text-muted">{r.activityCount}</TD>
                <TD className="whitespace-nowrap text-muted">
                  {new Date(r.createdAt).toLocaleString()}
                </TD>
              </TR>
            ))}
            {!error && runs !== null && runs.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-muted">
                  no executions
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
        />
      )}
    </div>
  )
}

function WorkflowRunDetailModal({
  name,
  executionId,
  onClose
}: {
  name: string
  executionId: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {name} <span className="font-mono text-xs text-muted">/ {executionId}</span>
          </h2>
          <button
            className="rounded px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
            onClick={onClose}
          >
            ✕ close
          </button>
        </div>
        <WorkflowRunPage name={name} executionId={executionId} />
      </div>
    </div>
  )
}
