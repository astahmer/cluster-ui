import * as React from "react"
import { api, type MetricPoint, type Overview } from "../api.ts"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { Sparkline } from "../components/sparkline.tsx"
import { ActivityDot, SkeletonCards, SkeletonTable, StatCard } from "../components/pieces.tsx"
import { Badge } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Banner } from "../kumo"

export function OverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null)
  const [history, setHistory] = React.useState<MetricPoint[]>([])

  const loadOverview = React.useRef(async () => setData(await api.overview()))
  const loadHistory = React.useRef(async () => {
    try {
      const points = await api.metricsHistory()
      // tolerate older servers / mocks returning a non-array
      setHistory(Array.isArray(points) ? points : [])
    } catch {
      // sampler may not be running (older server) — sparklines just stay empty
    }
  })

  const overviewLive = useLive(() => loadOverview.current())
  useLive(() => loadHistory.current())

  if (overviewLive.loading && !data)
    return (
      <div className="space-y-4">
        <SkeletonCards />
        <SkeletonCards count={2} />
        <SkeletonTable rows={5} cols={4} />
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Pending" value={m.pending} sub="waiting to be delivered" />
        <StatCard label="In-flight" value={m.inflight} sub="read in the last 5 min" />
        <StatCard label="Scheduled" value={m.scheduled} sub="deliver_at in the future" />
        <StatCard
          label="Failed"
          value={m.failed}
          sub="exited with Failure"
          tone={m.failed > 0 ? "err" : undefined}
        />
        <StatCard label="Done" value={m.done} sub="processed messages" />
      </div>

      <Card className="mt-3">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Activity — last hour</CardTitle>
          <span className="text-[11px] text-kumo-subtle">{history.length} samples</span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricSeries label="Pending depth" tone="accent" history={history} pick={(p) => p.pending} />
            <MetricSeries label="In-flight" tone="info" history={history} pick={(p) => p.inflight} />
            <MetricSeries label="Failed" tone="err" history={history} pick={(p) => p.failed} />
            <MetricSeries
              label="Unassigned shards"
              tone="warn"
              history={history}
              pick={(p) => p.unassignedShards}
            />
          </div>
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
            {data!.topEntities.map((e) => (
              <div key={e.entityType} className="flex items-center justify-between text-[13px]">
                <code className="truncate text-kumo-brand/90">{e.entityType}</code>
                <span className="flex items-center gap-2 tabular-nums text-kumo-subtle">
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
            <ActivityDot at={data!.serverTime} />
            <p className="mt-2 text-[12px] leading-5 text-kumo-subtle">
              Message ids are snowflakes — their embedded timestamp powers the “last activity”
              views. Status windows mirror the cluster: a message is in-flight for 5 minutes after
              being read.
            </p>
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
  pick
}: {
  label: string
  tone: "accent" | "info" | "err" | "warn"
  history: MetricPoint[]
  pick: (p: MetricPoint) => number
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
      />
    </div>
  )
}

function ShardBar({ assigned, total }: { assigned: number; total: number }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full border border-kumo-line bg-kumo-canvas">
      <div
        className="h-full bg-kumo-brand transition-all"
        style={{ width: `${(assigned / total) * 100}%` }}
      />
    </div>
  )
}
