import * as React from "react"
import { api, type MessageStatus, type WorkflowRunDetail } from "../api.ts"
import { JsonBlock, StatusBadge, statusTone } from "../components/pieces.tsx"
import { Badge } from "../components/ui.tsx"
import { fmtTime } from "../format.ts"

export function WorkflowRunPage({
  name,
  executionId
}: {
  name: string
  executionId: string
}) {
  const [data, setData] = React.useState<WorkflowRunDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    api
      .workflowRun(name, executionId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [name, executionId])

  if (error) return <div className="text-[13px] text-err">{error}</div>
  if (!data) return <div className="text-muted">loading…</div>
  if (!data.run) return <div className="text-muted">run message not found</div>

  const run = data.run

  return (
    <div className="space-y-4 text-[13px]">
      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
        <Field label="Execution">
          <span className="font-mono text-xs">{executionId}</span>
        </Field>
        <Field label="Status">
          <StatusBadge status={run.status as MessageStatus} />
        </Field>
        <Field label="Started">{fmtTime(run.createdAt)}</Field>
        <Field label="Run message">
          <span className="font-mono text-xs text-muted">{run.id}</span>
        </Field>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Run input
        </h3>
        <JsonBlock value={run.payload} />
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Activity timeline ({data.activities.length})
        </h3>
        {data.activities.length === 0 ? (
          <div className="text-muted">no activities recorded</div>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {data.activities.map((a) => (
              <li key={a.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                    a.status === "done" ? "bg-ok" : "bg-warn"
                  }`}
                />
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[12px]">{a.tag}</code>
                  <Badge tone={statusTone[a.status]}>{a.status}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-muted">{fmtTime(a.createdAt)}</div>
                {a.payload !== null && (
                  <div className="mt-1">
                    <JsonBlock value={a.payload} max={140} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}
