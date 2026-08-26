import * as React from "react"
import { api, type MetricPoint, type Overview } from "../api.ts"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { Sparkline, type SparklineBrushRange } from "../components/sparkline.tsx"
import { SkeletonCards, SkeletonTable, StatCard } from "../components/pieces.tsx"
import { Badge, Button } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Banner, Tabs } from "../kumo"

const RANGES = [
  { label: "1h", ms: 3_600_000 },
  { label: "6h", ms: 6 * 3_600_000 },
  { label: "24h", ms: 24 * 3_600_000 },
  { label: "7d", ms: 7 * 24 * 3_600_000 }
]

export function OverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null)
  const [history, setHistory] = React.useState<MetricPoint[]>([])
  const [rangeMs, setRangeMs] = React.useState(RANGES[0].ms)
  const [brushRange, setBrushRange] = React.useState<SparklineBrushRange | null>(null)

  const loadOverview = React.useRef(async () => setData(await api.overview()))
  const loadHistoryRef = React.useRef<(ms: number) => Promise<void>>(async (ms: number) => {
    try {
      const points = await api.metricsHistory({ rangeMs: ms })
      // tolerate older servers / mocks returning a non-array
      setHistory(Array.isArray(points) ? points : [])
    } catch {
      // sampler may not be running (older server) — sparklines just stay empty
    }
  })
  const rangeRef = React.useRef(rangeMs)
  rangeRef.current = rangeMs
  const loadHistory = React.useRef(async () => loadHistoryRef.current(rangeRef.current))

  const overviewLive = useLive(() => loadOverview.current())
  useLive(() => loadHistory.current())
  React.useEffect(() => {
    void loadHistoryRef.current(rangeMs)
  }, [rangeMs])

  if (overviewLive.loading && !data)
    return (
      <div className="space-y-4">
        <SkeletonCards />
        <SkeletonCards count={2} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    )
  if (!data)
    return (
      <div>
        <PageHeader title="Overview" subtitle="live cluster state" />
        <ErrorNote error={overviewLive.error ?? "no data"} onRetry={overviewLive.refresh} />
        <SkeletonCards />
      </div>
    )
  const m = data!.messages
  const shards = data!.shards
  const unassigned = data!.unassignedShards ?? shards.total - shards.assigned

  return (
    <div>
      <PageHeader title="Overview" subtitle="live cluster state" />
      <ErrorNote error={overviewLive.error} onRetry={overviewLive.refresh} />

      {unassigned > 0 && (
        <Banner
          variant="error"
          title={`${unassigned} shard${unassigned === 1 ? "" : "s"} unassigned`}
          description="The shard manager is rebalancing or a runner is down."
          className="mb-3"
        >
          <a href="#/shards" className="shrink-0 underline underline-offset-2 hover:opacity-80">
            view shards →
          </a>
        </Banner>
      )}

      {/* 5 cards: 3-col middle tier keeps the last card from orphaning half-width;
          below sm the 5th card spans both columns instead of orphaning (UX audit #2) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Pending" value={m.pending} sub="waiting to be delivered" href="#/messages?status=pending" />
        <StatCard label="In-flight" value={m.inflight} sub="read in the last 5 min" href="#/messages?status=inflight" />
        <StatCard label="Scheduled" value={m.scheduled} sub="deliver_at in the future" href="#/messages?status=scheduled" />
        <StatCard
          label="Failed"
          value={m.failed}
          sub="exited with Failure"
          tone={m.failed > 0 ? "err" : undefined}
          href="#/messages?failed=true"
        />
        <div className="col-span-2 sm:col-span-1">
          <StatCard label="Done" value={m.done} sub="processed messages" href="#/messages?status=done" />
        </div>
      </div>

      <Card className="mt-3">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Activity — {RANGES.find((r) => r.ms === rangeMs)?.label ?? ""}</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-kumo-subtle">{history.length} samples</span>
            <Tabs
              variant="segmented"
              size="sm"
              tabs={RANGES.map((r) => ({ value: String(r.ms), label: r.label }))}
              value={String(rangeMs)}
              onValueChange={(v) => setRangeMs(Number(v))}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricSeries label="Pending depth" tone="accent" history={history} pick={(p) => p.pending} onBrush={setBrushRange} brushRange={brushRange} />
            <MetricSeries label="In-flight" tone="info" history={history} pick={(p) => p.inflight} onBrush={setBrushRange} brushRange={brushRange} />
            <MetricSeries label="Failed" tone="err" history={history} pick={(p) => p.failed} onBrush={setBrushRange} brushRange={brushRange} />
            <MetricSeries
              label="Unassigned shards"
              tone="warn"
              history={history}
              pick={(p) => p.unassignedShards}
              onBrush={setBrushRange}
              brushRange={brushRange}
            />
            <FailureRate history={history} onBrush={setBrushRange} brushRange={brushRange} />
          </div>
          {brushRange && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-kumo-brand/30 bg-kumo-tint/40 px-3 py-2 text-[12px]">
              <span>Selected {new Date(brushRange.from).toLocaleString()} → {new Date(brushRange.to).toLocaleString()}</span>
              <a className="text-kumo-link underline-offset-2 hover:underline" href={`#/messages?createdAfter=${brushRange.from}&createdBefore=${brushRange.to}`}>Messages</a>
              <a className="text-kumo-link underline-offset-2 hover:underline" href={`#/traces?createdAfter=${brushRange.from}&createdBefore=${brushRange.to}`}>Traces</a>
              <Button variant="ghost" size="sm" onClick={() => setBrushRange(null)}>clear range</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sharding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums text-kumo-default">{shards.assigned}</span>
              <span className="text-kumo-subtle">/ {shards.total} shards assigned</span>
            </div>
            <ShardBar assigned={shards.assigned} total={shards.total} />
            <div className="text-[12px] text-kumo-subtle">
              {data!.runners.total} runner{data!.runners.total === 1 ? "" : "s"} registered
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Busiest entities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data!.topEntities.length === 0 && (
              <div className="text-[13px] text-kumo-subtle">no activity yet</div>
            )}
            {data!.topEntities.map((e) => (
              <div
                key={e.entityType}
                className="flex min-w-0 items-center justify-between gap-2 text-[13px]"
              >
                <code className="min-w-0 truncate text-kumo-default">{e.entityType}</code>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-kumo-subtle">
                  {e.active > 0 && <Badge tone="warn">{e.active} active</Badge>}
                  {e.total} msgs
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workflows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data!.topWorkflows.length === 0 && (
              <div className="text-[13px] text-kumo-subtle">no workflow runs recorded</div>
            )}
            {data!.topWorkflows.map((w) => (
              <div key={w.name} className="flex items-center justify-between text-[13px]">
                <a
                  href={`#/workflows/${encodeURIComponent(w.name)}`}
                  className="truncate font-medium text-kumo-default hover:text-kumo-link"
                >
                  {w.name}
                </a>
                <span className="tabular-nums text-kumo-subtle">{w.runs} runs</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cluster time</CardTitle>
          </CardHeader>
          <CardContent>
            {/* rel-time of a polled server timestamp is always ~"0s ago" and tells
                the user nothing (UX audit #2) — surface actual clock skew instead */}
            {(() => {
              const skewSec = Math.round((data!.serverTime - Date.now()) / 1000)
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-xl font-semibold tabular-nums text-kumo-default"
                      title={`server reports ${new Date(data!.serverTime).toLocaleString()}`}
                    >
                      {new Date(data!.serverTime).toLocaleTimeString()}
                    </span>
                    {Math.abs(skewSec) > 2 ? (
                      <Badge tone="warn">
                        server clock {skewSec > 0 ? "+" : "−"}
                        {Math.abs(skewSec)}s vs this browser
                      </Badge>
                    ) : (
                      <Badge tone="ok">clocks in sync</Badge>
                    )}
                  </div>
                  <p className="text-[12px] leading-5 text-kumo-subtle">
                    Message ids are snowflakes — their embedded timestamp powers the “last activity”
                    views. Status windows mirror the cluster: a message is in-flight for 5 minutes after
                    being read.
                  </p>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricSeries({
  label,
  tone,
  history,
  pick,
  onBrush,
  brushRange
}: {
  label: string
  tone: "accent" | "info" | "err" | "warn"
  history: MetricPoint[]
  pick: (p: MetricPoint) => number
  onBrush: (range: SparklineBrushRange) => void
  brushRange: SparklineBrushRange | null
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          {label}
        </span>
      </div>
      <Sparkline
        points={history.map((p) => ({ t: p.t, v: pick(p) }))}
        tone={tone}
        height={96}
        onBrush={onBrush}
        brushRange={brushRange}
      />
    </div>
  )
}

function FailureRate({
  history,
  onBrush,
  brushRange
}: {
  history: MetricPoint[]
  onBrush: (range: SparklineBrushRange) => void
  brushRange: SparklineBrushRange | null
}) {
  const points = history
    .filter((p) => p.done + p.failed > 0)
    .map((p) => ({ t: p.t, v: (p.failed / (p.done + p.failed)) * 100 }))
  const latest = points.length > 0 ? points[points.length - 1].v : 0
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
          Failure rate %
        </span>
        {latest > 5 && <Badge tone="err">degraded</Badge>}
      </div>
      <Sparkline
        points={points}
        tone={latest > 5 ? "err" : "ok"}
        height={96}
        formatValue={(v) => v.toFixed(1) + "%"}
        onBrush={onBrush}
        brushRange={brushRange}
      />
    </div>
  )
}

function ShardBar({ assigned, total }: { assigned: number; total: number }) {
  // zero-guard like Runners' LoadBar — an empty cluster must not render NaN% width
  const pct = total > 0 ? (assigned / total) * 100 : 0
  return (
    <div className="h-3 w-full overflow-hidden rounded-full border border-kumo-line bg-kumo-canvas">
      <div className="h-full bg-kumo-brand transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}
