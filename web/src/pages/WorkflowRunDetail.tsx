import * as React from "react"
import {
  api,
  type MessageStatus,
  type RunResult,
  type WorkflowRunDetail
} from "../api.ts"
import { JsonBlock, StatusBadge, statusTone } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { FlowGraph, type FlowNodeSpec } from "../components/flow-graph.tsx"
import { confirmDialog } from "../components/dialogs.tsx"
import { toast } from "../toast.tsx"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { Banner, Text, cn } from "../kumo"
import { ArrowClockwise, Check, Copy, X, XCircle } from "@phosphor-icons/react"
import { fmtTime } from "../format.ts"
import { useExport } from "../export.ts"
import { triggerRefresh } from "../shell.tsx"
import { useAppConfig } from "../config.ts"

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
  const [timelineOpen, setTimelineOpen] = React.useState(true)
  const [view, setView] = React.useState<"timeline" | "graph">("timeline")
  const readonly = useAppConfig()?.readonly === true

  const run = data?.run ?? null
  const extras = (run ?? null) as (WorkflowRunDetail["run"] & RunExtras) | null
  const result = extras?.result ?? null


  // waterfall spans: run message + its activities on one shared axis; an
  // activity's bar runs until the next event (gaps between events are the signal)
  const activities = React.useMemo(
    () => [...((data?.activities ?? []) as ActivityRow[])].sort((a, b) => a.createdAt - b.createdAt),
    [data?.activities]
  )
  const activityExportRows = React.useMemo(
    () =>
      activities.map((a) => ({
        id: a.id,
        tag: a.tag,
        kind: a.kind,
        status: a.status,
        failed: a.failed === true,
        attempt: a.attempt,
        createdAt: a.createdAt
      })),
    [activities]
  )
  const exporters = useExport(activityExportRows, `run-${executionId}`)
  const timelineSpans = React.useMemo(() => {
    if (!run) return []
    const acts = activities
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
  }, [run, (data?.activities ?? []) as ActivityRow[], executionId, result])

  // DAG: workflow root -> activity steps (same source data as the waterfall)
  const attemptGroups = React.useMemo(() => {
    const groups = new Map<string, ActivityRow[]>()
    for (const activity of activities) {
      const key = activity.activityName ?? activity.tag ?? activity.kind
      const current = groups.get(key) ?? []
      current.push(activity)
      groups.set(key, current)
    }
    return [...groups.entries()].filter(([, entries]) => entries.length > 1)
  }, [activities])

  const flowSpecs = React.useMemo<FlowNodeSpec[]>(() => {
    if (!run) return []
    const activities = [...((data?.activities ?? []) as ActivityRow[])].sort((a, b) => a.createdAt - b.createdAt)
    return [
      {
        key: `run-${run.id}`,
        label: `workflow ${executionId}`,
        sublabel: `${activities.length} activities`,
        tone:
          run.status === "done" ? (result?.outcome === "Failure" ? "danger" : "success") : "warning",
        children: activities.map((a) => ({
          key: a.id,
          label: a.activityName ?? a.tag ?? a.kind,
          sublabel:
            typeof a.attempt === "number" && a.attempt > 1 ? `attempt ${a.attempt}` : a.status,
          tone: a.failed ? ("danger" as const) : a.status === "done" ? ("success" as const) : ("running" as const)
        }))
      }
    ]
  }, [run, (data?.activities ?? []) as ActivityRow[], executionId, result])


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


  const resetActivityFromHere = async (activity: ActivityRow) => {
    if (
      !(await confirmDialog({
        title: `Reset activity "${activity.activityName ?? activity.tag ?? activity.kind}"?`,
        description: "This clears the selected activity's processed/read markers so the cluster can run it again. It does not rewind other workflow state.",
        destructive: true,
        confirmLabel: "Reset activity"
      }))
    ) return
    setBusy(true)
    try {
      await api.resetActivity(activity.id)
      toast.success("Activity reset")
      triggerRefresh()
      onChanged?.()
      setTimeout(() => reload.current(), 250)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg)
      toast.error(`reset activity failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

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

  if (error)
    return (
      <div>
        {/* bare-span error replaced with ErrorNote + retry (UX audit #2) */}
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-kumo-danger/30 bg-kumo-danger-tint px-3 py-2 text-[13px] text-kumo-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => reload.current()}
            className="shrink-0 cursor-pointer rounded-md border border-kumo-danger/40 px-2 py-0.5 text-[12px] font-medium hover:bg-kumo-danger-tint"
          >
            Retry
          </button>
        </div>
      </div>
    )
  if (!data) return <span className="text-[13px] text-kumo-subtle">loading…</span>
  if (!run) return <span className="text-[13px] text-kumo-subtle">run message not found</span>

  const canRetry = run.status === "done"
  const canCancel = run.status === "pending" || run.status === "inflight" || run.status === "scheduled"

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
                <span>Flow</span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-normal text-kumo-subtle">
                    {data.activities.length} activities
                  </span>
                  <span
                    role="group"
                    aria-label="flow view"
                    className="flex overflow-hidden rounded-md border border-kumo-line text-[11px]"
                  >
                    <button
                      type="button"
                      aria-pressed={view === "graph"}
                      className={`cursor-pointer px-2 py-0.5 ${view === "graph" ? "bg-kumo-tint text-kumo-default" : "text-kumo-subtle hover:bg-kumo-tint"}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTimelineOpen(true)
                        setView("graph")
                      }}
                    >
                      DAG
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "timeline"}
                      className={`cursor-pointer px-2 py-0.5 ${view === "timeline" ? "bg-kumo-tint text-kumo-default" : "text-kumo-subtle hover:bg-kumo-tint"}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTimelineOpen(true)
                        setView("timeline")
                      }}
                    >
                      Timeline
                    </button>
                  </span>
                  <span className="font-normal">{timelineOpen ? "hide" : "show"}</span>
                </span>
              </button>
            </CardTitle>
          </CardHeader>
          {timelineOpen && (
            <CardContent>
              {view === "graph" ? <FlowGraph specs={flowSpecs} /> : <SpanWaterfall spans={timelineSpans} />}
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
            <Button size="sm" disabled={busy || readonly} title={readonly ? "read-only mode" : undefined} onClick={() => void act("retry")}>
              <ArrowClockwise className="h-3.5 w-3.5" /> retry run
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="danger" disabled={busy || readonly} title={readonly ? "read-only mode" : undefined} onClick={() => void act("interrupt")}>
              <X className="h-3.5 w-3.5" /> cancel run
            </Button>
          )}
          <span className="text-[11px] text-kumo-subtle">
            retry re-runs the workflow from its first pending activity
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
        <h3 className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          <span>Event history ({(data.eventHistory ?? data.activities).length})</span>
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={activityExportRows.length === 0}
              onClick={exporters.json}
            >
              export (json)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={activityExportRows.length === 0}
              onClick={exporters.csv}
            >
              export (csv)
            </Button>
          </span>
        </h3>
        {(data.eventHistory ?? []).length === 0 && data.activities.length === 0 ? (
          <span className="text-kumo-subtle">no events recorded</span>
        ) : (
          <ol className="relative space-y-3 border-l border-kumo-line pl-4">
            {(data.eventHistory ?? data.activities.map((a) => ({
              id: a.id,
              timestamp: a.createdAt,
              event: a.failed ? "activity-failed" : `activity-${a.status}`,
              activityName: a.activityName,
              attempt: a.attempt,
              payload: a.payload
            }))).map((event) => {
              const activity = (data.activities as ActivityRow[]).find((a) => a.id === event.id)
              return (
                <li key={event.id} className="relative">
                  <span className={cn("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full", event.event.includes("failed") ? "bg-kumo-danger" : event.event.includes("done") ? "bg-kumo-success" : "bg-kumo-warning")} />
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate text-[12px]">{event.activityName ?? event.event}
                      {typeof event.attempt === "number" && event.attempt > 1 && <Badge tone="warn" className="ml-2">attempt {event.attempt}</Badge>}
                    </code>
                    <Badge tone={event.event.includes("failed") ? "err" : event.event.includes("done") ? "ok" : "neutral"}>{event.event}</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-kumo-subtle">{fmtTime(event.timestamp)}</div>
                  {event.payload !== null && (
                    <details className="mt-1 rounded border border-kumo-line bg-kumo-recessed px-2 py-1">
                      <summary className="cursor-pointer text-[11px] text-kumo-subtle">show payload</summary>
                      <div className="mt-1"><JsonBlock value={event.payload} max={500} /></div>
                    </details>
                  )}
                  {activity && <Button variant="ghost" size="sm" disabled={busy || readonly} title={readonly ? "read-only mode" : "reset only this activity; does not rewind the whole run"} onClick={() => void resetActivityFromHere(activity)}>reset this activity</Button>}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {attemptGroups.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">Attempt comparison</h3>
          <div className="space-y-2">
            {attemptGroups.map(([name, entries]) => (
              <details key={name} className="rounded-md border border-kumo-line bg-kumo-base">
                <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium">{name} · {entries.length} attempts</summary>
                <div className="grid gap-2 border-t border-kumo-line p-2 md:grid-cols-2">
                  {entries.map((entry) => (
                    <div key={entry.id} className="min-w-0">
                      <div className="mb-1 text-[11px] text-kumo-subtle">attempt {entry.attempt ?? "?"} · {fmtTime(entry.createdAt)}</div>
                      <JsonBlock value={entry.payload} max={500} />
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
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
        <strong className="flex items-center gap-1.5 text-[13px]">
          {ok ? <Check className="h-4 w-4 text-kumo-success" /> : <XCircle className="h-4 w-4 text-kumo-danger" />}
          {ok ? "run completed successfully" : "run failed"}
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
