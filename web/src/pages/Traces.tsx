import * as React from "react"
import { Stack } from "@phosphor-icons/react"
import { api, type Message, type TraceSummary } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { DetailPanel, SkeletonTable, StatusBadge, rowInteractions } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { ErrorNote, PageHeader, useEscToClose, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { fmtTime } from "../format.ts"

/**
 * Traces — messages grouped by trace id.
 * List: recent traces with span counts; clicking a row opens the span
 * waterfall in an in-page side panel (no navigation). The dedicated
 * #/traces/<id> view shares the same body via TraceDetailBody
 * (see docs/ROADMAP.md §4).
 */

export function TracesPage() {
  const [traces, setTraces] = React.useState<TraceSummary[]>([])
  const [openTraceId, setOpenTraceId] = React.useState<string | null>(null)
  const { loading, error, refresh } = useLive(async () => setTraces(await api.traces()))

  useEscToClose(() => setOpenTraceId(null))

  if (loading && traces.length === 0) return <SkeletonTable />

  return (
    <div>
      <PageHeader title="Traces" subtitle="messages grouped by trace id — newest first">
        <span className="text-[12px] text-kumo-subtle">click a trace for its waterfall</span>
      </PageHeader>
      <ErrorNote error={error} onRetry={refresh} />
      {/* server caps the listing at 50 — say so instead of silently truncating (P1-15) */}
      {traces.length > 0 && (
        <p className="mb-2 text-[12px] text-kumo-subtle">
          showing latest {traces.length} traces{traces.length === 50 ? " (server cap)" : ""}
        </p>
      )}

      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Trace ID</TH>
              <TH className="text-right">Spans</TH>
              <TH>Services</TH>
              <TH>First span</TH>
              <TH>Last span</TH>
              <TH className="text-right">Duration</TH>
            </TR>
          </THead>
          <TBody>
            {traces.map((t) => {
              const short = t.traceId.length > 16 ? `${t.traceId.slice(0, 13)}…` : t.traceId
              return (
                <TR
                  key={t.traceId}
                  className="cursor-pointer hover:bg-kumo-recessed/60"
                  {...rowInteractions(() => setOpenTraceId(t.traceId))}
                >
                  <TD>
                    <a
                      href={`#/traces/${encodeURIComponent(t.traceId)}`}
                      onClick={(e) => e.stopPropagation()}
                      title={t.traceId}
                      className="font-mono text-[12px] font-medium underline-offset-2 hover:text-kumo-link hover:underline"
                    >
                      {short}
                    </a>
                  </TD>
                  <TD className="text-right tabular-nums">{t.count}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {(t.services.length > 0 ? t.services : ["—"]).map((k) => (
                        <Badge key={k} tone="info">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="text-kumo-subtle">{fmtTime(t.firstAt)}</TD>
                  <TD className="text-kumo-subtle">{fmtTime(t.lastAt)}</TD>
                  <TD className="text-right tabular-nums">{formatDuration(traceDurationHint(t))}</TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
        {traces.length === 0 && (
          <Empty
            icon={<Stack className="h-8 w-8 text-kumo-subtle" />}
            title="No traces yet"
            description="Messages carrying a trace_id appear here grouped into traces."
          />
        )}
      </div>

      <DetailPanel
        open={openTraceId !== null}
        onClose={() => setOpenTraceId(null)}
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs">trace {openTraceId && shortId(openTraceId)}</span>
            {openTraceId && (
              <a
                href={`#/traces/${encodeURIComponent(openTraceId)}`}
                className="text-[11px] text-kumo-subtle underline-offset-2 hover:text-kumo-link hover:underline"
                onClick={() => setOpenTraceId(null)}
              >
                open full page ↗
              </a>
            )}
          </span>
        }
      >
        {openTraceId !== null && <TraceDetailBody traceId={openTraceId} compact />}
      </DetailPanel>
    </div>
  )
}

/** Dedicated #/traces/<id> page — wraps the shared body with page chrome. */
export function TraceDetailPage({ traceId }: { traceId: string }) {
  return (
    <div>
      <PageHeader title={`Trace ${shortId(traceId)}`} subtitle="span waterfall, oldest first">
        <a href="#/traces" className="text-[13px] text-kumo-subtle hover:text-kumo-default">
          ← all traces
        </a>
      </PageHeader>
      <TraceDetailBody traceId={traceId} />
    </div>
  )
}

/**
 * Shared trace body: waterfall + span table. `compact` drops the table so the
 * side panel stays focused on the cascade.
 */
function TraceDetailBody({ traceId, compact }: { traceId: string; compact?: boolean }) {
  const [rows, setRows] = React.useState<Message[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const { refresh } = useLive(async () => {
    try {
      const res = await api.trace(traceId)
      setRows(res.rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [traceId])

  const spans = toSpans(rows ?? [])
  const totalMs = spans.length >= 2 ? Math.max(...spans.map((s) => s.endMs)) - Math.min(...spans.map((s) => s.startMs)) : 0

  return (
    <div>
      <ErrorNote error={error} onRetry={refresh} />

      {rows === null ? (
        <SkeletonTable />
      ) : rows.length < 2 ? (
        <div className="rounded-lg border border-kumo-line px-4 py-6 text-center text-[13px] text-kumo-subtle">
          Not enough timed spans in this trace for a waterfall.
        </div>
      ) : (
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-kumo-subtle">
            <span>
              waterfall — {formatDuration(totalMs)} total · {rows.length} spans
            </span>
          </div>
          <SpanWaterfall spans={spans} />
        </div>
      )}

      {!compact && rows !== null && rows.length > 0 && (
        <div className="mt-3 rounded-lg border border-kumo-line bg-kumo-base">
          <Table>
            <THead>
              <TR>
                <TH>Status</TH>
                <TH>Entity</TH>
                <TH>Kind</TH>
                <TH>Tag</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <StatusBadge status={m.status} />
                  </TD>
                  <TD className="font-medium">
                    {m.entityType}/{m.entityId}
                  </TD>
                  <TD className="text-kumo-subtle">{m.kind}</TD>
                  <TD className="font-mono text-[11px] text-kumo-subtle">{m.tag || "—"}</TD>
                  <TD className="text-kumo-subtle">{fmtTime(m.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function toSpans(rows: ReadonlyArray<Message>): TimelineSpan[] {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
  // prefer the real span duration recorded in headers (`spanDurationMs`, as the
  // engine/OTel bridge writes it); fall back to deriving an end from the next
  // span's start, with a nominal bar for the last span
  return sorted.map((m, i) => {
    const next = sorted[i + 1]
    let durMs: number | null = null
    try {
      const h = m.headers !== null ? (JSON.parse(m.headers) as Record<string, unknown>) : null
      const d = h?.spanDurationMs
      if (typeof d === "number" && Number.isFinite(d) && d > 0) durMs = d
    } catch {
      // malformed headers → heuristic fallback
    }
    const endMs =
      durMs !== null ? m.createdAt + durMs : next ? Math.max(next.createdAt, m.createdAt + 1) : m.createdAt + Math.max(totalHint(sorted), 250)
    return {
      key: m.id,
      label: (
        <>
          <span className="font-medium">{m.tag || m.entityType}</span>
          {m.tag && m.entityType && <span className="text-kumo-subtle"> · {m.entityType}</span>}
        </>
      ),
      group: m.entityType,
      startMs: m.createdAt,
      endMs,
      tone: m.failed ? "danger" : m.status === "done" ? "success" : "default",
      badge: undefined
    }
  })
}

function totalHint(sorted: ReadonlyArray<Message>): number {
  if (sorted.length < 2) return 250
  return Math.max(250, sorted[sorted.length - 1].createdAt - sorted[0].createdAt)
}

/** list-row duration hint: first→last creation window (real durations live per-span) */
function traceDurationHint(t: TraceSummary): number {
  return t.lastAt - t.firstAt
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 13)}…` : id
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
