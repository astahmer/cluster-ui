import * as React from "react"
import {
  api,
  type MessageStatus,
  type RunResult,
  type WorkflowRunDetail
} from "../api.ts"
import { JsonBlock, StatusBadge, statusTone } from "../components/pieces.tsx"
import { Badge, Button } from "../components/ui.tsx"
import { fmtTime } from "../format.ts"
import { triggerRefresh } from "../shell.tsx"

/** the run row carries extra server fields beyond the base client type */
interface RunExtras {
  result?: RunResult | null
}

interface ActivityRow {
  id: string
  tag: string | null
  kind: string
  status: MessageStatus
  failed?: boolean
  activityName?: string
  attempt?: number
  payload: unknown
  createdAt: number
}

export function WorkflowRunPage({
  name,
  executionId,
  onChanged
}: {
  name: string
  executionId: string
  onChanged?: () => void
}) {
  const [data, setData] = React.useState<WorkflowRunDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const reload = React.useRef(() => {
    api
      .workflowRun(name, executionId)
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(reload.current, [name, executionId])

  const run = data?.run ?? null
  const extras = (run ?? null) as (WorkflowRunDetail["run"] & RunExtras) | null
  const result = extras?.result ?? null

  const act = async (kind: "retry" | "interrupt") => {
    if (!run) return
    const what =
      kind === "retry" ?
        `Retry workflow run "${executionId}"? The run message will be re-delivered to its entity.` :
        `Cancel workflow run "${executionId}"? An Interrupt envelope will be written and consumed by the cluster.`
    if (!window.confirm(what)) return
    setBusy(true)
    setActionError(null)
    try {
      if (kind === "retry") await api.retryMessage(run.id)
      else await api.interruptMessage(run.id)
      triggerRefresh()
      onChanged?.()
      // give the write a beat to land before refetching
      setTimeout(() => reload.current(), 250)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="text-[13px] text-err">{error}</div>
  if (!data) return <div className="text-muted">loading…</div>
  if (!run) return <div className="text-muted">run message not found</div>

  const canRetry = run.status === "done"
  const canCancel = run.status === "pending" || run.status === "inflight" || run.status === "scheduled"

  return (
    <div className="space-y-4 text-[13px]">
      {result && (
        <OutcomeBanner outcome={result.outcome} exit={result.exit} />
      )}

      {actionError && (
        <div className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-err">
          {actionError}
        </div>
      )}

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

      {(canRetry || canCancel) && (
        <section className="flex items-center gap-2">
          {canRetry && (
            <Button size="sm" disabled={busy} onClick={() => void act("retry")}>
              ↻ retry run
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void act("interrupt")}>
              ✕ cancel run
            </Button>
          )}
          <span className="text-[11px] text-muted">
            writes go through the cluster's own storage semantics
          </span>
        </section>
      )}

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
            {(data.activities as ActivityRow[]).map((a) => (
              <li key={a.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                    a.failed ? "bg-err" : a.status === "done" ? "bg-ok" : "bg-warn"
                  }`}
                />
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[12px]">
                    {a.activityName ?? a.tag}
                    {typeof a.attempt === "number" && a.attempt > 1 && (
                      <Badge tone="warn" className="ml-2">
                        attempt {a.attempt}
                      </Badge>
                    )}
                  </code>
                  <Badge tone={a.failed ? "err" : statusTone[a.status]}>
                    {a.failed ? "failed" : a.status}
                  </Badge>
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

function OutcomeBanner({ outcome, exit }: { outcome: "Success" | "Failure"; exit: unknown }) {
  const ok = outcome === "Success"
  return (
    <div
      className={
        "rounded-md border px-3 py-2 " +
        (ok ? "border-ok/40 bg-ok/10 text-ok" : "border-err/40 bg-err/10 text-err")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-[13px]">
          {ok ? "✓ run completed successfully" : "✕ run failed"}
        </strong>
        <Badge tone={ok ? "ok" : "err"}>{outcome}</Badge>
      </div>
      {!ok && (
        <div className="mt-2 [&_pre]:max-h-40 [&_pre]:text-[11px]">
          <JsonBlock value={exit} />
        </div>
      )}
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
