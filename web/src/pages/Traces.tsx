import * as React from "react"
import { Copy, MagnifyingGlass, Stack } from "@phosphor-icons/react"
import { api, type Message, type TraceSort, type TraceStatusFilter, type TraceSummary } from "../api.ts"
import { Badge, Button, Input, Select, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { DetailPanel, Pager, SkeletonTable, StatusBadge, useHashParam } from "../components/pieces.tsx"
import { SpanWaterfall, type TimelineSpan } from "../components/timeline.tsx"
import { Breadcrumbs, ErrorNote, PageHeader, useCluster, useEscToClose, useLive } from "../shell.tsx"
import { Empty } from "../kumo"
import { fmtTime } from "../format.ts"
import { useExport } from "../export.ts"

const TRACE_SORTS = ["newest", "oldest", "duration", "spans", "failures"] as const

/**
 * Traces — messages grouped by trace id.
 * List: recent traces with span counts; opening a trace ID shows the span
 * waterfall in an in-page side panel (no navigation). The dedicated
 * #/traces/<id> view shares the same body via TraceDetailBody
 * (see docs/ROADMAP.md §4).
 */

export function TracesPage() {
  const [rows, setRows] = React.useState<TraceSummary[] | null>(null)
  const [total, setTotal] = React.useState(0)
  // P1-15: trace-id substring search + offset paging
  const [search, setSearch] = useHashParam("q")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [pageParam, setPageParam] = useHashParam("page")
  const page = Math.max(1, Number.parseInt(pageParam || "1", 10) || 1)
  const setPage = (next: number) => setPageParam(next <= 1 ? "" : String(next))
  const [createdAfter, setCreatedAfter] = useHashParam("createdAfter")
  const [createdBefore, setCreatedBefore] = useHashParam("createdBefore")
  const [service, setService] = useHashParam("service")
  const [statusParam, setStatusParam] = useHashParam("status")
  const [minDurationParam, setMinDurationParam] = useHashParam("minDurationMs")
  const [sortParam, setSortParam] = useHashParam("sort")
  const [pageSizeParam, setPageSizeParam] = useHashParam("pageSize")
  const status: TraceStatusFilter = statusParam === "healthy" || statusParam === "failed" ? statusParam : "all"
  const sort: TraceSort = TRACE_SORTS.find((value) => value === sortParam) ?? "newest"
  const pageSizeValue = Number.parseInt(pageSizeParam || "50", 10)
  const pageSize = [25, 50, 100, 200].includes(pageSizeValue) ? pageSizeValue : 50
  const minDurationMs = [1000, 10_000, 60_000].includes(Number(minDurationParam)) ? Number(minDurationParam) : undefined
  const [openTraceParam, setOpenTraceParam] = useHashParam("trace")
  const openTraceId = openTraceParam || null
  const setOpenTraceId = (traceId: string | null) => setOpenTraceParam(traceId ?? "", traceId === null ? undefined : { history: "push" })

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [search])

  React.useEffect(() => {
    setPage(1)
  }, [service, status, minDurationMs, sort, pageSize])

  const { loading, error, refresh } = useLive(async () => {
    const res = await api.traces({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: debouncedSearch || undefined,
      service: service || undefined,
      status,
      minDurationMs,
      sort,
      createdAfter: parseEpoch(createdAfter),
      createdBefore: parseEpoch(createdBefore)
    })
    setRows(res.rows)
    setTotal(res.total)
    // refetch when paging or searching, not just on the poll interval
  }, [page, debouncedSearch, service, status, minDurationMs, sort, createdAfter, createdBefore, pageSize])

  useEscToClose(() => setOpenTraceId(null))

  // UX-AUDIT-2: shared export affordance over the currently visible page
  const exportRows = React.useMemo(
    () =>
      (rows ?? []).map((t) => ({
        traceId: t.traceId,
        spans: t.count,
        failedSpans: t.failedCount,
        services: t.services.join(","),
        firstSpanAt: t.firstAt,
        lastSpanAt: t.lastAt
      })),
    [rows]
  )
  const exporters = useExport(exportRows, "traces")
  const listContext = React.useMemo(
    () => traceListQuery({ search, page, pageSize, service, status, minDurationMs, sort, createdAfter, createdBefore }),
    [createdAfter, createdBefore, minDurationMs, page, pageSize, search, service, sort, status]
  )
  const tracePageHref = (traceId: string) => `#/traces/${encodeURIComponent(traceId)}${listContext ? `?${listContext}` : ""}`

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
        <span className="text-[12px] text-kumo-subtle">select a trace ID for its waterfall</span>
      </PageHeader>
      <ErrorNote error={error} onRetry={refresh} />
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-kumo-line bg-kumo-base p-2">
        <label className="min-w-44 flex-1 text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
          service or entity type
          <Input
            aria-label="search trace services"
            placeholder="filter services…"
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="mt-1 h-8 w-full"
          />
        </label>
        <label className="text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
          status
          <Select aria-label="trace status" className="mt-1 h-8" value={status} onChange={(event) => setStatusParam(event.target.value === "all" ? "" : event.target.value)}>
            <option value="all">all traces</option>
            <option value="healthy">healthy</option>
            <option value="failed">failed</option>
          </Select>
        </label>
        <label className="text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
          sort
          <Select aria-label="trace sort" className="mt-1 h-8" value={sort} onChange={(event) => setSortParam(event.target.value === "newest" ? "" : event.target.value)}>
            <option value="newest">newest first</option>
            <option value="oldest">oldest first</option>
            <option value="duration">longest window</option>
            <option value="spans">most spans</option>
            <option value="failures">most failures</option>
          </Select>
        </label>
        <label className="text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
          duration
          <Select aria-label="minimum trace duration" className="mt-1 h-8" value={minDurationMs ? String(minDurationMs) : ""} onChange={(event) => setMinDurationParam(event.target.value)}>
            <option value="">any window</option>
            <option value="1000">≥ 1 second</option>
            <option value="10000">≥ 10 seconds</option>
            <option value="60000">≥ 1 minute</option>
          </Select>
        </label>
        <label className="text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
          page size
          <Select aria-label="trace page size" className="mt-1 h-8" value={String(pageSize)} onChange={(event) => setPageSizeParam(event.target.value === "50" ? "" : event.target.value)}>
            {[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size} / page</option>)}
          </Select>
        </label>
        {(service || status !== "all" || minDurationMs || sort !== "newest") && (
          <Button variant="ghost" size="sm" onClick={() => {
            setService("")
            setStatusParam("")
            setMinDurationParam("")
            setSortParam("")
            setPage(1)
          }}>clear filters</Button>
        )}
      </div>
      {(createdAfter || createdBefore) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-kumo-subtle">
          <span>time brush: {createdAfter ? fmtTime(Number(createdAfter)) : "…"} → {createdBefore ? fmtTime(Number(createdBefore)) : "…"}</span>
          <Button variant="ghost" size="sm" onClick={() => {
            setCreatedAfter("")
            setCreatedBefore("")
            setPage(1)
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
        <div className="space-y-2 p-2 sm:hidden">
          {traces.map((trace) => {
            const short = trace.traceId.length > 16 ? `${trace.traceId.slice(0, 13)}…` : trace.traceId
            return (
              <article key={trace.traceId} className="rounded-md border border-kumo-line bg-kumo-canvas p-3">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" aria-label={`open trace ${trace.traceId}`} onClick={() => setOpenTraceId(trace.traceId)} className="min-w-0 truncate text-left font-mono text-xs font-medium text-kumo-link underline-offset-2 hover:underline">
                    {short}
                  </button>
                  <a href={tracePageHref(trace.traceId)} aria-label={`open full trace ${trace.traceId}`} className="shrink-0 text-sm text-kumo-subtle hover:text-kumo-link">↗</a>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-kumo-subtle">
                  <span className="tabular-nums">{trace.count} spans</span>
                  {trace.failedCount > 0 ? <Badge tone="err">{trace.failedCount} failed</Badge> : <Badge tone="ok">healthy</Badge>}
                  <span className="tabular-nums">window {formatDuration(traceDurationHint(trace))}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-kumo-subtle">
                  <span className="truncate">{trace.services.length > 0 ? trace.services.slice(0, 2).join(" · ") : "no service metadata"}</span>
                  <button type="button" aria-label={`copy trace ${trace.traceId}`} title="copy trace ID" onClick={() => copyText(trace.traceId)} className="shrink-0 p-1 hover:text-kumo-default">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        <div className="hidden sm:block">
        <Table>
          <THead>
            <TR>
              <TH>Trace ID</TH>
              <TH className="text-right">Spans</TH>
              <TH>Status</TH>
              <TH className="hidden sm:table-cell">Services</TH>
              <TH className="hidden md:table-cell">First message</TH>
              <TH className="hidden md:table-cell">Last message</TH>
              {/* this column is the first→last creation window, NOT critical-path
                  duration — say so where people read it (UX audit #2) */}
              <TH className="hidden text-right md:table-cell" title="time from the first to last message in this trace; individual span durations live in the waterfall">
                Message window
              </TH>
            </TR>
          </THead>
          <TBody>
            {traces.map((t) => {
              const short = t.traceId.length > 16 ? `${t.traceId.slice(0, 13)}…` : t.traceId
              return (
                <TR key={t.traceId} className="hover:bg-kumo-recessed/60">
                  <TD className="max-w-[12rem]">
                    <div className="flex min-w-0 items-center gap-1">
                      <button type="button" aria-label={`open trace ${t.traceId}`} title={`${t.traceId} · open waterfall`} onClick={() => setOpenTraceId(t.traceId)} className="min-w-0 truncate text-left font-mono text-[12px] font-medium text-kumo-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand">
                        {short}
                      </button>
                      <button type="button" aria-label={`copy trace ${t.traceId}`} title="copy trace ID" onClick={() => copyText(t.traceId)} className="shrink-0 p-1 text-kumo-subtle hover:text-kumo-default">
                        <Copy className="h-3 w-3" />
                      </button>
                      <a href={tracePageHref(t.traceId)} aria-label={`open full trace ${t.traceId}`} title="open full trace page" className="shrink-0 p-1 text-kumo-subtle hover:text-kumo-link">
                        ↗
                      </a>
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums">{t.count}</TD>
                  <TD>
                    {t.failedCount > 0 ? <Badge tone="err">{t.failedCount} failed</Badge> : <Badge tone="ok">healthy</Badge>}
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(t.services.length > 0 ? t.services.slice(0, 2) : ["—"]).map((k) => (
                        <Badge key={k} tone="info">
                          {k}
                        </Badge>
                      ))}
                      {t.services.length > 2 && <span className="text-[11px] text-kumo-subtle">+{t.services.length - 2} more</span>}
                    </div>
                  </TD>
                  <TD className="hidden text-kumo-subtle md:table-cell">{fmtTime(t.firstAt)}</TD>
                  <TD className="hidden text-kumo-subtle md:table-cell">{fmtTime(t.lastAt)}</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">
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
        </div>
        {traces.length === 0 && (
          <Empty
            icon={<Stack className="h-8 w-8 text-kumo-subtle" />}
            title={debouncedSearch !== "" || service !== "" || status !== "all" || minDurationMs !== undefined ? "No traces match these filters" : "No traces yet"}
            description={
              debouncedSearch !== "" || service !== "" || status !== "all" || minDurationMs !== undefined ?
                "Try clearing a filter or widening the time range." :
                "Messages carrying a trace_id appear here grouped into traces."
            }
          />
        )}
      </div>

      <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} showJump />

      <DetailPanel
        open={openTraceId !== null}
        onClose={() => setOpenTraceId(null)}
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs">trace {openTraceId && shortId(openTraceId)}</span>
            {openTraceId && (
                <a
                  href={tracePageHref(openTraceId)}
                className="text-[11px] text-kumo-subtle underline-offset-2 hover:text-kumo-link hover:underline"
                onClick={() => setOpenTraceId(null)}
              >
                open full page ↗
              </a>
            )}
          </span>
        }
      >
        {openTraceId !== null && (
          <TraceDetailBody
            traceId={openTraceId}
            compact
            returnTo={`/traces?trace=${encodeURIComponent(openTraceId)}${listContext ? `&${listContext}` : ""}`}
          />
        )}
      </DetailPanel>
    </div>
  )
}

/** Dedicated #/traces/<id> page — wraps the shared body with page chrome. */
export function TraceDetailPage({ traceId, listHref, returnTo }: { traceId: string; listHref: string; returnTo: string }) {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Traces", href: "#" + listHref }, { label: shortId(traceId) }]} />
      <PageHeader title={`Trace ${shortId(traceId)}`} subtitle="execution timeline — oldest first">
        <button type="button" className="inline-flex items-center gap-1 text-[12px] text-kumo-subtle hover:text-kumo-default" onClick={() => copyText(traceId)}>
          <Copy className="h-3 w-3" /> copy trace id
        </button>
        <button type="button" className="text-[12px] text-kumo-subtle hover:text-kumo-default" onClick={() => copyText(window.location.href)}>
          copy link
        </button>
      </PageHeader>
      <TraceDetailBody traceId={traceId} returnTo={returnTo} />
    </div>
  )
}

/**
 * Shared trace body: waterfall + span table. `compact` drops the table so the
 * side panel stays focused on the cascade.
 */
function TraceDetailBody({ traceId, compact, returnTo = "/traces/" + encodeURIComponent(traceId) }: { traceId: string; compact?: boolean; returnTo?: string }) {
  const [rows, setRows] = React.useState<Message[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [streamState, setStreamState] = React.useState<"connecting" | "live" | "polling">("connecting")
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)
  const cluster = useCluster()
  const [spanSearch, setSpanSearch] = useHashParam("spanQ")
  const [focusParam, setFocusParam] = useHashParam("spanFocus")
  const [groupParam, setGroupParam] = useHashParam("spanGroup")
  const [zoomParam, setZoomParam] = useHashParam("spanZoom")
  const [slowThresholdParam, setSlowThresholdParam] = useHashParam("spanSlowMs")
  const [selectedKey, setSelectedKey] = useHashParam("span")
  const focus: "all" | "failed" | "slow" = focusParam === "failed" || focusParam === "slow" ? focusParam : "all"
  const groupBy: "entity" | "kind" | "status" = groupParam === "kind" || groupParam === "status" ? groupParam : "entity"
  const zoomValue = Number(zoomParam)
  const zoom = [1, 1.5, 2, 2.5, 3].includes(zoomValue) ? zoomValue : 1
  const slowThresholdValue = Number(slowThresholdParam)
  const slowThreshold = [1000, 5000, 10_000].includes(slowThresholdValue) ? slowThresholdValue : 1000
  const [collapsedGroups, setCollapsedGroups] = React.useState<ReadonlySet<string>>(new Set())
  const { refresh } = useLive(async () => {
    try {
      const res = await api.trace(traceId)
      setRows(res.rows)
      setLastUpdated(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [traceId], streamState !== "live")
  const refreshRef = React.useRef(refresh)
  React.useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

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

  const spans = React.useMemo(() => enrichSpans(toSpans(rows ?? [], groupBy)), [groupBy, rows])
  const filteredSpans = React.useMemo(() => {
    const query = spanSearch.trim().toLowerCase()
    return spans.filter((span) => {
      const matchesQuery = query === "" || span.searchText?.toLowerCase().includes(query)
      const matchesFocus = focus === "all" || (focus === "failed" ? span.tone === "danger" : span.endMs - span.startMs >= slowThreshold)
      return matchesQuery && matchesFocus
    })
  }, [focus, slowThreshold, spanSearch, spans])
  const selectedSpan = filteredSpans.find((span) => span.key === selectedKey) ?? null
  React.useEffect(() => {
    if (rows !== null && selectedKey && selectedSpan === null) setSelectedKey("")
  }, [rows, selectedKey, selectedSpan])
  const failedCount = spans.filter((span) => span.tone === "danger").length
  const slowestSpan = spans.reduce<TimelineSpan | null>((slowest, span) => {
    if (slowest === null || span.endMs - span.startMs > slowest.endMs - slowest.startMs) return span
    return slowest
  }, null)
  const waterfallExtentMs = spans.length >= 2 ? Math.max(...spans.map((s) => s.endMs)) - Math.min(...spans.map((s) => s.startMs)) : 0
  const messageWindowMs = rows !== null && rows.length >= 2 ? Math.max(...rows.map((row) => row.createdAt)) - Math.min(...rows.map((row) => row.createdAt)) : 0
  const slowCount = spans.filter((span) => span.endMs - span.startMs >= slowThreshold).length
  const groups = [...new Set(spans.map((span) => span.group).filter((group): group is string => Boolean(group)))]
  const clearInvestigation = () => {
    setSpanSearch("")
    setFocusParam("")
    setGroupParam("")
    setZoomParam("")
    setSlowThresholdParam("")
    setSelectedKey("")
    setCollapsedGroups(new Set())
  }

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
                <span>waterfall extent {formatDuration(waterfallExtentMs)}</span>
                <span>message window {formatDuration(messageWindowMs)}</span>
                <span>{rows.length} spans</span>
                {failedCount > 0 && <Badge tone="err">{failedCount} failed</Badge>}
                {slowestSpan && <span>slowest {formatDuration(slowestSpan.endMs - slowestSpan.startMs)}</span>}
              </div>
              {failedCount > 0 && (
                <p className="mt-2 rounded-md border border-kumo-danger/30 bg-kumo-danger/5 px-2 py-1.5 text-[11px] text-kumo-subtle">
                  {failedCount} failed span{failedCount === 1 ? "" : "s"}. Select a failed bar to inspect its message and use the message detail actions to retry or interrupt it.
                </p>
              )}
              <p className="mt-1 text-[11px] text-kumo-subtle">
                Select a span to inspect its message, timing, and related IDs. Recorded bars use engine timing; estimated bars use neighboring message timestamps.
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-kumo-subtle">
              <Badge tone={streamState === "live" ? "ok" : "neutral"}>
                {streamState === "connecting" ? "connecting" : streamState === "live" ? "receiving updates" : "polling"}
              </Badge>
              {lastUpdated && <span aria-live="polite">updated {fmtTime(lastUpdated)}</span>}
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
                <Button key={value} variant={focus === value ? "secondary" : "ghost"} size="sm" onClick={() => setFocusParam(value === "all" ? "" : value)}>
                  {value === "all" ? `all spans (${spans.length})` : value === "failed" ? `failed (${failedCount})` : `slow ≥ ${formatDuration(slowThreshold)} (${slowCount})`}
                </Button>
              ))}
              <Select aria-label="slow span threshold" className="h-8" value={String(slowThreshold)} onChange={(event) => setSlowThresholdParam(event.target.value === "1000" ? "" : event.target.value)}>
                <option value="1000">slow ≥ 1s</option>
                <option value="5000">slow ≥ 5s</option>
                <option value="10000">slow ≥ 10s</option>
              </Select>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-kumo-subtle">
              group by
              <Select
                aria-label="group spans by"
                className="h-8"
                value={groupBy}
                onChange={(event) => {
                  setGroupParam(event.target.value)
                  setCollapsedGroups(new Set())
                }}
              >
                <option value="entity">entity type</option>
                <option value="kind">message kind</option>
                <option value="status">status</option>
              </Select>
            </label>
            {groups.length > 1 && (
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setCollapsedGroups(new Set(groups))}>collapse groups</Button>
                <Button variant="ghost" size="sm" onClick={() => setCollapsedGroups(new Set())}>expand groups</Button>
              </span>
            )}
            <div className="flex items-center gap-1" role="group" aria-label="timeline zoom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom out timeline"
                disabled={zoom <= 1}
                onClick={() => setZoomParam(String(Math.max(1, zoom - 0.5)))}
              >
                −
              </Button>
              <span className="min-w-10 text-center text-[11px] tabular-nums text-kumo-subtle">{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom in timeline"
                disabled={zoom >= 3}
                onClick={() => setZoomParam(String(Math.min(3, zoom + 0.5)))}
              >
                +
              </Button>
            </div>
            <span className="ml-auto text-[11px] tabular-nums text-kumo-subtle">
              showing {filteredSpans.length}/{spans.length}
            </span>
            {(spanSearch || focus !== "all" || groupBy !== "entity" || zoom !== 1 || slowThreshold !== 1000 || selectedKey) && (
              <Button variant="ghost" size="sm" onClick={clearInvestigation}>reset investigation</Button>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-kumo-subtle" aria-label="timeline legend">
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-success" /> completed</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-danger" /> failed</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-kumo-brand/70" /> active/unknown</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm border-2 border-kumo-link" /> critical path</span>
            <span className="inline-flex items-center gap-1"><span className="text-[12px]">∥</span> overlaps another span</span>
            <span className="ml-auto">click a row for details · drag horizontally for long traces</span>
          </div>
          <SpanWaterfall
            spans={filteredSpans}
            zoom={zoom}
            selectedKey={selectedKey}
            collapsedGroups={collapsedGroups}
            onToggleGroup={(group) => setCollapsedGroups((current) => {
              const next = new Set(current)
              if (next.has(group)) next.delete(group)
              else next.add(group)
              return next
            })}
            onSelect={(span) => setSelectedKey(span.key)}
          />
          {filteredSpans.length === 0 && (
            <div className="rounded-md border border-dashed border-kumo-line px-3 py-5 text-center text-[12px] text-kumo-subtle">
              No spans match this investigation filter. <button type="button" className="underline" onClick={clearInvestigation}>reset investigation</button>
            </div>
          )}
          {selectedSpan && (
            <SpanInspector traceId={traceId} span={selectedSpan} returnTo={returnTo} onClose={() => setSelectedKey("")} />
          )}
        </div>
      )}

      {!compact && rows !== null && rows.length > 0 && (
          <div id="trace-messages" className="mt-3 rounded-lg border border-kumo-line bg-kumo-base">
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
                    <a href={traceMessageHref(traceId, m.id, returnTo)} className="hover:text-kumo-link hover:underline">
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

function toSpans(rows: ReadonlyArray<Message>, groupBy: "entity" | "kind" | "status" = "entity"): TimelineSpan[] {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
  const rowsById = new Map(sorted.map((row) => [row.id, row]))
  const depthById = new Map<string, number>()
  const depthFor = (row: Message, trail = new Set<string>()): number => {
    const cached = depthById.get(row.id)
    if (cached !== undefined) return cached
    if (!row.requestId || row.requestId === row.id || !rowsById.has(row.requestId) || trail.has(row.id)) return 0
    const nextTrail = new Set(trail)
    nextTrail.add(row.id)
    const depth = depthFor(rowsById.get(row.requestId)!, nextTrail) + 1
    depthById.set(row.id, depth)
    return depth
  }
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
    const entityLabel = m.entityId.length > 18 ? `${m.entityId.slice(0, 8)}…${m.entityId.slice(-6)}` : m.entityId
    const group =
      groupBy === "kind" ? m.kind :
      groupBy === "status" ? (m.failed ? "failed" : m.status) :
      m.entityType
    return {
      key: m.id,
      label: (
        <>
          <span className="font-medium">{label}</span>
          {m.entityType && <span className="text-kumo-subtle"> · {m.entityType}</span>}
          {m.entityId && <span className="text-[10px] text-kumo-subtle"> · {entityLabel}</span>}
        </>
      ),
      group,
      startMs: m.createdAt,
      endMs,
      tone: m.failed ? "danger" : m.status === "done" ? "success" : "default",
      badge: <span className="shrink-0 text-[9px] text-kumo-subtle">{durationSource === "recorded" ? "real" : "est."}</span>,
      detail: `${m.entityType}/${m.entityId} · ${m.kind} · ${m.tag || "untagged"} · ${m.status}${m.failed ? " · failed" : ""}`,
      searchText: `${label} ${m.entityType} ${m.entityId} ${m.kind} ${m.tag ?? ""} ${m.status} ${m.failed ? "failed" : ""}`,
      durationSource,
      parentKey: m.requestId && m.requestId !== m.id && rowsById.has(m.requestId) ? m.requestId : undefined,
      depth: depthFor(m)
    }
  })
}

function enrichSpans(spans: TimelineSpan[]): TimelineSpan[] {
  const byKey = new Map(spans.map((span) => [span.key, span]))
  const children = new Map<string, TimelineSpan[]>()
  for (const span of spans) {
    if (!span.parentKey || !byKey.has(span.parentKey)) continue
    const siblings = children.get(span.parentKey) ?? []
    siblings.push(span)
    children.set(span.parentKey, siblings)
  }
  const chainCache = new Map<string, { duration: number; keys: string[] }>()
  const longestChainFrom = (span: TimelineSpan, trail = new Set<string>()): { duration: number; keys: string[] } => {
    const cached = chainCache.get(span.key)
    if (cached) return cached
    if (trail.has(span.key)) return { duration: 0, keys: [] }
    const nextTrail = new Set(trail)
    nextTrail.add(span.key)
    let bestChild = { duration: 0, keys: [] as string[] }
    for (const child of children.get(span.key) ?? []) {
      const candidate = longestChainFrom(child, nextTrail)
      if (candidate.duration > bestChild.duration) bestChild = candidate
    }
    const result = {
      duration: Math.max(0, span.endMs - span.startMs) + bestChild.duration,
      keys: [span.key, ...bestChild.keys]
    }
    chainCache.set(span.key, result)
    return result
  }
  let criticalPath = { duration: 0, keys: [] as string[] }
  for (const span of spans) {
    const candidate = longestChainFrom(span)
    if (candidate.duration > criticalPath.duration) criticalPath = candidate
  }
  const criticalKeys = new Set(criticalPath.keys)
  return spans.map((span) => ({
    ...span,
    critical: criticalKeys.has(span.key),
    concurrent: spans.some((other) => other.key !== span.key && other.startMs < span.endMs && other.endMs > span.startMs)
  }))
}

function SpanInspector({ traceId, span, returnTo, onClose }: { traceId: string; span: TimelineSpan; returnTo: string; onClose: () => void }) {
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
        <a href={traceMessageHref(traceId, span.key, returnTo)} className="text-xs text-kumo-link underline-offset-2 hover:underline">open message detail ↗</a>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-kumo-subtle hover:text-kumo-default" onClick={() => copyText(span.key)}><Copy className="h-3 w-3" /> copy message id</button>
      </div>
    </section>
  )
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {})
}

function traceMessageHref(traceId: string, messageId: string, returnTo = "/traces/" + encodeURIComponent(traceId)): string {
  const params = new URLSearchParams({
    returnTo,
    returnLabel: "back to trace"
  })
  return "#/messages/" + encodeURIComponent(messageId) + "?" + params.toString()
}

function traceListQuery(values: {
  search: string
  page: number
  pageSize: number
  service: string
  status: TraceStatusFilter
  minDurationMs: number | undefined
  sort: TraceSort
  createdAfter: string
  createdBefore: string
}): string {
  const params = new URLSearchParams()
  if (values.search) params.set("q", values.search)
  if (values.page > 1) params.set("page", String(values.page))
  if (values.pageSize !== 50) params.set("pageSize", String(values.pageSize))
  if (values.service) params.set("service", values.service)
  if (values.status !== "all") params.set("status", values.status)
  if (values.minDurationMs) params.set("minDurationMs", String(values.minDurationMs))
  if (values.sort !== "newest") params.set("sort", values.sort)
  if (values.createdAfter) params.set("createdAfter", values.createdAfter)
  if (values.createdBefore) params.set("createdBefore", values.createdBefore)
  return params.toString()
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
