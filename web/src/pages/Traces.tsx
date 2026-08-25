import * as React from "react"
import { Stack } from "@phosphor-icons/react"
import { api, type Message, type TraceSummary } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { StatusBadge } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { fmtTime } from "../format.ts"

/**
 * Traces — messages grouped by trace id.
 * List: recent traces with span counts. Detail (#/traces/<id>): span waterfall
 * ordered by snowflake-derived timestamps (see docs/ROADMAP.md §4).
 */

export function TracesPage() {
  const [traces, setTraces] = React.useState<TraceSummary[]>([])
  const { loading, error, refresh } = useLive(async () => setTraces(await api.traces()))

  if (loading && traces.length === 0) return null

  return (
    <div>
      <PageHeader title="Traces" subtitle="messages grouped by trace id — newest first" />
      <ErrorNote error={error} onRetry={refresh} />

      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Trace ID</TH>
              <TH className="text-right">Spans</TH>
              <TH>Kinds</TH>
              <TH>First span</TH>
              <TH>Last span</TH>
              <TH className="text-right">Duration</TH>
            </TR>
          </THead>
          <TBody>
            {traces.map((t) => {
              const short = t.traceId.length > 16 ? `${t.traceId.slice(0, 13)}…` : t.traceId
              return (
                <TR key={t.traceId}>
                  <TD>
                    <a
                      href={`#/traces/${encodeURIComponent(t.traceId)}`}
                      className="font-mono text-[12px] font-medium hover:text-kumo-link hover:underline"
                    >
                      {short}
                    </a>
                  </TD>
                  <TD className="text-right tabular-nums">{t.count}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {(t.kinds.length > 0 ? t.kinds : ["—"]).map((k) => (
                        <Badge key={k} tone="info">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="text-kumo-subtle">{fmtTime(t.firstAt)}</TD>
                  <TD className="text-kumo-subtle">{fmtTime(t.lastAt)}</TD>
                  <TD className="text-right tabular-nums">{formatDuration(t.lastAt - t.firstAt)}</TD>
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
    </div>
  )
}

export function TraceDetailPage({ traceId }: { traceId: string }) {
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
  const totalMs = rows && rows.length >= 2 ? spans[spans.length - 1].endMs - spans[0].startMs : 0

  return (
    <div>
      <PageHeader title={`Trace ${traceId}`} subtitle={`${rows?.length ?? 0} spans`}>
        <a href="#/traces" className="text-[13px] text-kumo-subtle hover:text-kumo-default">
          ← all traces
        </a>
      </PageHeader>
      <ErrorNote error={error} onRetry={refresh} />

      {rows === null ? null : rows.length < 2 ? (
        <div className="rounded-lg border border-kumo-line px-4 py-6 text-center text-[13px] text-kumo-subtle">
          Not enough timed spans in this trace for a waterfall.
        </div>
      ) : (
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-kumo-subtle">
            <span>waterfall — {formatDuration(totalMs)} total</span>
          </div>
          <SpanWaterfall spans={spans} />
        </div>
      )}

      {rows !== null && rows.length > 0 && (
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
  // derive an end from the next span's start (span lasts until its successor),
  // last span gets a nominal duration so it renders as a bar
  return sorted.map((m, i) => {
    const next = sorted[i + 1]
    const endMs = next ? Math.max(next.createdAt, m.createdAt + 1) : m.createdAt + Math.max(totalHint(sorted), 250)
    return {
      key: m.id,
      label:
        m.entityId ? (
          <>
            <span className="font-medium">{m.entityType}</span>
            <span className="text-kumo-inactive">/{m.entityId}</span>
          </>
        ) : (
          m.entityType || m.kind
        ),
      group: m.kind,
      startMs: m.createdAt,
      endMs,
      tone: m.status === "done" ? "success" : "default",
      badge: m.tag || undefined
    }
  })
}

function totalHint(sorted: ReadonlyArray<Message>): number {
  if (sorted.length < 2) return 250
  return Math.max(250, sorted[sorted.length - 1].createdAt - sorted[0].createdAt)
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
