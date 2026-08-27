import * as React from "react"
import { Copy, MagnifyingGlass, Stack, WarningCircle } from "@phosphor-icons/react"
import { api, type Message, type TraceSummary } from "../api.ts"
import { Badge, Button, Input, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { DetailPanel, SkeletonTable, StatusBadge, rowInteractions, Pager } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { ErrorNote, PageHeader, useCluster, useEscToClose, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { fmtTime } from "../format.ts"
import { useExport } from "../export.ts"

/**
 * Traces — messages grouped by trace id.
 * List: recent traces with span counts; clicking a row opens the span
 * waterfall in an in-page side panel (no navigation). The dedicated
 * #/traces/<id> view shares the same body via TraceDetailBody
 * (see docs/ROADMAP.md §4).
 */

export function TracesPage({
  initialFilters
}: {
  initialFilters?: { createdAfter?: string; createdBefore?: string }
}) {
  const [rows, setRows] = React.useState<TraceSummary[] | null>(null)
  const [total, setTotal] = React.useState(0)
  // P1-15: trace-id substring search + offset paging
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [createdAfter, setCreatedAfter] = React.useState(initialFilters?.createdAfter ?? "")
  const [createdBefore, setCreatedBefore] = React.useState(initialFilters?.createdBefore ?? "")
  const pageSize = 50
  const [openTraceId, setOpenTraceId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [search])

  const { loading, error, refresh } = useLive(async () => {
    const res = await api.traces({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: debouncedSearch || undefined,
      createdAfter: parseEpoch(createdAfter),
      createdBefore: parseEpoch(createdBefore)
    })
    setRows(res.rows)
    setTotal(res.total)
    // refetch when paging or searching, not just on the poll interval
  }, [page, debouncedSearch, createdAfter, createdBefore])

  useEscToClose(() => setOpenTraceId(null))

  // UX-AUDIT-2: shared export affordance over the currently visible page
  const exportRows = React.useMemo(
    () =>
      (rows ?? []).map((t) => ({
        traceId: t.traceId,
        spans: t.count,
        services: t.services.join(","),
        firstSpanAt: t.firstAt,
        lastSpanAt: t.lastAt
      })),
    [rows]
  )
  const exporters = useExport(exportRows, "traces")

  if (loading && rows === null) return <SkeletonTable />
  const traces = rows ?? []
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div>
      <PageHeader title="Traces" subtitle="messages grouped by trace id — newest first">
        <Input
          aria-label="search traces"
          placeholder="filter by trace id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
        <span className="text-[12px] text-kumo-subtle">click a trace for its waterfall</span>
      </PageHeader>
      <ErrorNote error={error} onRetry={refresh} />
      {(createdAfter || createdBefore) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-kumo-subtle">
          <span>time brush: {createdAfter ? fmtTime(Number(createdAfter)) : "…"} → {createdBefore ? fmtTime(Number(createdBefore)) : "…"}</span>
          <Button variant="ghost" size="sm" onClick={() => {
            setCreatedAfter("")
            setCreatedBefore("")
            window.location.hash = "#/traces"
          }}>clear range</Button>
        </div>
      )}
      {/* accurate window driven by server total instead of a silent cap (P1-15) */}
      {total > 0 && (
        <p className="mb-2 text-[12px] text-kumo-subtle">
          {total} trace{total === 1 ? "" : "s"} · showing {from}–{to}
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
              {/* this column is the first→last creation window, NOT critical-path
                  duration — say so where people read it (UX audit #2) */}
              <TH className="text-right" title="time from first to last span creation — individual span durations live in the waterfall">
                Duration
              </TH>
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
                  <TD className="text-right tabular-nums">
                    <span
                      title="first → last span creation window — see the waterfall for real span durations"
                    >
                      {formatDuration(traceDurationHint(t))}
                    </span>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
        {traces.length === 0 && (
          <Empty
            icon={<Stack className="h-8 w-8 text-kumo-subtle" />}
            title={debouncedSearch !== "" ? "No traces match" : "No traces yet"}
            description={
              debouncedSearch !== "" ?
                `Nothing carries a trace_id containing "${debouncedSearch}".` :
                "Messages carrying a trace_id appear here grouped into traces."
            }
          />
        )}
      </div>

      <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} />

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
  const [streamState, setStreamState] = React.useState<"connecting" | "live" | "polling">("connecting")
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)
  const cluster = useCluster()
  const [spanSearch, setSpanSearch] = React.useState("")
  const [focus, setFocus] = React.useState<"all" | "failed" | "slow">("all")
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const { refresh } = useLive(async () => {
    try {
      const res = await api.trace(traceId)
      setRows(res.rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [traceId], streamState !== "live")
  const refreshRef = React.useRef(refresh)
  refreshRef.current = refresh

  React.useEffect(() => {
    if (typeof EventSource === "undefined") {
      setStreamState("polling")
      return
    }
    const source = new EventSource(api.traceEventsUrl(traceId))
    const onTrace = (event: Event) => {
      try {
        const body = JSON.parse((event as MessageEvent).data) as { rows?: unknown; sentAt?: number }
        if (!Array.isArray(body.rows)) throw new Error("invalid trace stream payload")
        setRows(body.rows as Message[])
        setLastUpdated(typeof body.sentAt === "number" ? body.sentAt : Date.now())
        setError(null)
      } catch {
        // malformed frames are ignored; the next frame or polling fallback remains authoritative
      }
    }
    const onTraceError = (event: Event) => {
      source.close()
      setStreamState("polling")
      try {
        const body = JSON.parse((event as MessageEvent).data) as { error?: unknown }
        setError(typeof body.error === "string" ? body.error : "live trace stream failed; using polling")
      } catch {
        setError("live trace stream failed; using polling")
      }
      refreshRef.current()
    }
    source.addEventListener("trace", onTrace)
    source.addEventListener("trace-error", onTraceError)
    source.onopen = () => setStreamState("live")
    source.onerror = () => {
      source.close()
      setStreamState("polling")
      setError((previous) => previous ?? "live trace stream unavailable; using polling")
      refreshRef.current()
    }
    return () => {
      source.removeEventListener("trace", onTrace)
      source.removeEventListener("trace-error", onTraceError)
      source.close()
    }
  }, [traceId, cluster])

  const spans = toSpans(rows ?? [])
  const filteredSpans = React.useMemo(() => {
    const query = spanSearch.trim().toLowerCase()
    return spans.filter((span) => {
      const matchesQuery = query === "" || span.searchText?.toLowerCase().includes(query)
      const matchesFocus = focus === "all" || (focus === "failed" ? span.tone === "danger" : span.endMs - span.startMs >= 1000)
      return matchesQuery && matchesFocus
    })
  }, [focus, spanSearch, spans])
  const selectedSpan = spans.find((span) => span.key === selectedKey) ?? null
  const failedCount = spans.filter((span) => span.tone === "danger").length
  const slowestSpan = spans.reduce<TimelineSpan | null>((slowest, span) => {
    if (slowest === null || span.endMs - span.startMs > slowest.endMs - slowest.startMs) return span
    return slowest
  }, null)
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
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-kumo-subtle">
                <span className="font-medium text-kumo-default">Trace timeline</span>
                <span>{formatDuration(totalMs)} total</span>
                <span>{rows.length} spans</span>
                {failedCount > 0 && <Badge tone="err">{failedCount} failed</Badge>}
                {slowestSpan && <span>slowest {formatDuration(slowestSpan.endMs - slowestSpan.startMs)}</span>}
              </div>
              <p className="mt-1 text-[11px] text-kumo-subtle">
                Select a span to inspect its message, timing, and related IDs. Bars marked inferred use neighboring message timestamps.
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-kumo-subtle">
              <Badge tone={streamState === "live" ? "ok" : "neutral"}>
                {streamState === "live" ? "live" : "polling"}
              </Badge>
              {lastUpdated && <span>updated {fmtTime(lastUpdated)}</span>}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-kumo-line bg-kumo-canvas p-2">
            <label className="relative min-w-48 flex-1 sm:max-w-xs">
              <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-kumo-subtle" />
              <Input
                aria-label="search spans"
                placeholder="search spans, tags, entities…"
                value={spanSearch}
                onChange={(event) => setSpanSearch(event.target.value)}
                className="h-8 pl-7"
              />
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="trace focus">
              {(["all", "failed", "slow"] as const).map((value) => (
                <Button key={value} variant={focus === value ? "secondary" : "ghost"} size="sm" onClick={() => setFocus(value)}>
                  {value === "all" ? "all spans" : value === "failed" ? "failed" : "slow ≥ 1s"}
                </Button>
              ))}
            </div>
            <span className="ml-auto text-[11px] tabular-nums text-kumo-subtle">
              showing {filteredSpans.length}/{spans.length}
            </span>
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-kumo-subtle" aria-label="timeline legend">
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-success" /> completed</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-danger" /> failed</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-brand/70" /> active/unknown</span>
            <span className="ml-auto">click any row for details</span>
          </div>
          <SpanWaterfall spans={filteredSpans} selectedKey={selectedKey} onSelect={(span) => setSelectedKey(span.key)} />
          {filteredSpans.length === 0 && (
            <div className="rounded-md border border-dashed border-kumo-line px-3 py-5 text-center text-[12px] text-kumo-subtle">
              No spans match this focus. <button type="button" className="underline" onClick={() => { setFocus("all"); setSpanSearch("") }}>clear filters</button>
            </div>
          )}
          {selectedSpan && (
            <SpanInspector span={selectedSpan} onClose={() => setSelectedKey(null)} />
          )}
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
                    {m.failed && <Badge tone="err" className="ml-1">failed</Badge>}
                  </TD>
                  <TD className="font-medium">
                    <a href={`#/messages/${encodeURIComponent(m.id)}`} className="hover:text-kumo-link hover:underline">
                      {m.entityType}/{m.entityId}
                    </a>
                  </TD>
                  <TD className="text-kumo-subtle">{m.kind}</TD>
                  <TD className="font-mono text-[11px] text-kumo-subtle">{m.tag || "—"}</TD>
                  <TD className="text-kumo-subtle">
                    <span className="mr-2">{fmtTime(m.createdAt)}</span>
                    <button type="button" className="text-kumo-subtle hover:text-kumo-default" aria-label={`copy message ${m.id}`} title="copy message id" onClick={() => copyText(m.id)}>
                      <Copy className="inline h-3 w-3" />
                    </button>
                  </TD>
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
    const durationSource = durMs !== null ? "recorded" : "inferred"
    const endMs =
      durMs !== null ? m.createdAt + durMs : next ? Math.max(next.createdAt, m.createdAt + 1) : m.createdAt + Math.max(totalHint(sorted), 250)
    const label = m.tag || m.entityType
    return {
      key: m.id,
      label: (
        <>
          <span className="font-medium">{label}</span>
          {m.tag && m.entityType && <span className="text-kumo-subtle"> · {m.entityType}</span>}
        </>
      ),
      group: m.entityType,
      startMs: m.createdAt,
      endMs,
      tone: m.failed ? "danger" : m.status === "done" ? "success" : "default",
      badge: <span className="shrink-0 text-[9px] text-kumo-subtle">{durationSource === "recorded" ? "real" : "est."}</span>,
      detail: `${m.entityType}/${m.entityId} · ${m.kind} · ${m.tag || "untagged"} · ${m.status}${m.failed ? " · failed" : ""}`,
      searchText: `${label} ${m.entityType} ${m.entityId} ${m.kind} ${m.tag ?? ""}`,
      durationSource
    }
  })
}

function SpanInspector({ span, onClose }: { span: TimelineSpan; onClose: () => void }) {
  const duration = Math.max(0, span.endMs - span.startMs)
  return (
    <section className="mt-3 rounded-md border border-kumo-brand/40 bg-kumo-canvas p-3" aria-label="selected span details">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">Selected span</div>
          <div className="mt-1 truncate text-sm font-medium">{span.detail ?? "span"}</div>
        </div>
        <button type="button" className="text-xs text-kumo-subtle underline hover:text-kumo-default" onClick={onClose}>clear</button>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
        <div><dt className="text-kumo-subtle">Started</dt><dd className="mt-0.5 tabular-nums">{fmtTime(span.startMs)}</dd></div>
        <div><dt className="text-kumo-subtle">Duration</dt><dd className="mt-0.5 tabular-nums">{formatDuration(duration)}</dd></div>
        <div><dt className="text-kumo-subtle">Status</dt><dd className="mt-0.5">{span.tone === "danger" ? "failed" : span.tone === "success" ? "completed" : "active/unknown"}</dd></div>
        <div><dt className="text-kumo-subtle">Timing</dt><dd className="mt-0.5">{span.durationSource === "recorded" ? "recorded" : "inferred"}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={`#/messages/${encodeURIComponent(span.key)}`} className="text-xs text-kumo-link underline-offset-2 hover:underline">open message detail ↗</a>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-kumo-subtle hover:text-kumo-default" onClick={() => copyText(span.key)}><Copy className="h-3 w-3" /> copy message id</button>
      </div>
    </section>
  )
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {})
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

function parseEpoch(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
