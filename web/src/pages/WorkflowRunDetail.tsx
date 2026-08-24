import * as React from "react"
import {
  api,
  type MessageStatus,
  type RunResult,
  type WorkflowRunDetail
} from "../api.ts"
import { JsonBlock, StatusBadge, statusTone } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { confirmDialog } from "../components/dialogs.tsx"
import { toast } from "../toast.tsx"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { Banner, Text, cn } from "../kumo"
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
    if (
      !(await confirmDialog({
        title:
          kind === "retry" ?
            `Retry workflow run "${executionId}"?` :
            `Cancel workflow run "${executionId}"?`,
        description:
          kind === "retry" ?
            "The run message will be re-delivered to its entity." :
            "An Interrupt envelope will be written and consumed by the cluster.",
        destructive: true,
        confirmLabel: kind === "retry" ? "Retry" : "Cancel run"
      }))
    )
      return
    setBusy(true)
    setActionError(null)
    try {
      if (kind === "retry") await api.retryMessage(run.id)
      else await api.interruptMessage(run.id)
      toast.success(kind === "retry" ? "Run retry queued" : "Interrupt written")
      triggerRefresh()
      onChanged?.()
      // give the write a beat to land before refetching
      setTimeout(() => reload.current(), 250)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg)
      toast.error(`${kind} failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <span className="text-[13px] text-kumo-danger">{error}</span>
  if (!data) return <span className="text-[13px] text-kumo-subtle">loading…</span>
  if (!run) return <span className="text-[13px] text-kumo-subtle">run message not found</span>

  const canRetry = run.status === "done"
  const canCancel = run.status === "pending" || run.status === "inflight" || run.status === "scheduled"
  const [timelineOpen, setTimelineOpen] = React.useState(true)

  // waterfall spans: run message + its activities on one shared axis; an
  // activity's bar runs until the next event (gaps between events are the signal)
  const timelineSpans = React.useMemo(() => {
    if (!run) return []
    const activities = [...(data.activities as ActivityRow[])].sort((a, b) => a.createdAt - b.createdAt)
    const spans: TimelineSpan[] = [
      {
        key: `run-${run.id}`,
        label: `workflow ${executionId}`,
        group: "workflow",
        startMs: run.createdAt,
        endMs: activities.length > 0 ? activities[activities.length - 1].createdAt : run.createdAt,
        tone:
          run.status === "done" ? (result?.outcome === "Failure" ? "danger" : "success") : "warning",
        badge: result?.outcome === "Failure" ? <Badge tone="err">failed</Badge> : undefined
      }
    ]
    activities.forEach((a, i) => {
      const next = activities[i + 1]
      spans.push({
        key: a.id,
        label: a.activityName ?? a.tag ?? a.kind,
        group: a.activityName ? "activities" : (a.tag ?? a.kind),
        startMs: a.createdAt,
        endMs: next ? next.createdAt : a.createdAt,
        tone: a.failed ? "danger" : a.status === "done" ? "success" : "warning",
        badge:
          typeof a.attempt === "number" && a.attempt > 1 ? (
            <Badge tone="warn">attempt {a.attempt}</Badge>
          ) : undefined
      })
    })
    return spans
  }, [run, data.activities, executionId, result])

  return (
    <div className="space-y-4 text-[13px]">
      {result && (
        <OutcomeBanner outcome={result.outcome} exit={result.exit} />
      )}

      {actionError && <Banner variant="error">{actionError}</Banner>}

      {timelineSpans.length >= 2 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle>
              <button
                type="button"
                onClick={() => setTimelineOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center justify-between text-left"
                aria-expanded={timelineOpen}
              >
                <span>Timeline</span>
                <span className="text-[11px] font-normal text-kumo-subtle">
                  {timelineOpen ? "hide" : "show"} · {data.activities.length} activities
                </span>
              </button>
            </CardTitle>
          </CardHeader>
          {timelineOpen && (
            <CardContent>
              <SpanWaterfall spans={timelineSpans} />
            </CardContent>
          )}
        </Card>
      )}

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-kumo-line bg-kumo-recessed p-3">
        <Field label="Execution">
          <span className="font-mono text-xs">{executionId}</span>
        </Field>
        <Field label="Status">
          <StatusBadge status={run.status as MessageStatus} />
        </Field>
        <Field label="Started">{fmtTime(run.createdAt)}</Field>
        <Field label="Run message">
          <span className="font-mono text-xs text-kumo-subtle">{run.id}</span>
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
          <span className="text-[11px] text-kumo-subtle">
            writes go through the cluster's own storage semantics
          </span>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          Run input
        </h3>
        <JsonBlock value={run.payload} />
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          Activity timeline ({data.activities.length})
        </h3>
        {data.activities.length === 0 ? (
          <span className="text-kumo-subtle">no activities recorded</span>
        ) : (
          <ol className="relative space-y-3 border-l border-kumo-line pl-4">
            {(data.activities as ActivityRow[]).map((a) => (
              <li key={a.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full",
                    a.failed ? "bg-kumo-danger" : a.status === "done" ? "bg-kumo-success" : "bg-kumo-warning"
                  )}
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
                <div className="mt-0.5 text-[11px] text-kumo-subtle">{fmtTime(a.createdAt)}</div>
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
      className={cn(
        "rounded-md border px-3 py-2",
        ok ? "border-kumo-success/40 bg-kumo-success-tint" : "border-kumo-danger/40 bg-kumo-danger-tint"
      )}
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
      <span className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}
