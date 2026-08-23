import * as React from "react"
import { api, type Overview } from "../api.ts"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { ActivityDot, StatCard } from "../components/pieces.tsx"
import { Badge } from "../components/ui.tsx"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"

export function OverviewPage() {
  const [data, setData] = React.useState<Overview | null>(null)
  const { loading, error } = usePolling(async () => setData(await api.overview()))

  if (loading && !data) return null
  const m = data!.messages
  const shards = data!.shards

  return (
    <div>
      <PageHeader title="Overview" subtitle="live cluster state" />
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={m.pending} sub="waiting to be delivered" />
        <StatCard label="In-flight" value={m.inflight} sub="read in the last 5 min" />
        <StatCard label="Scheduled" value={m.scheduled} sub="deliver_at in the future" />
        <StatCard label="Done" value={m.done} sub="processed messages" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sharding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums">{shards.assigned}</span>
              <span className="text-muted">/ {shards.total} shards assigned</span>
            </div>
            <ShardBar assigned={shards.assigned} total={shards.total} />
            <div className="text-[12px] text-muted">
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
                <code className="truncate text-accent/90">{e.entityType}</code>
                <span className="flex items-center gap-2 tabular-nums text-muted">
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
              <div className="text-[13px] text-muted">no workflow runs recorded</div>
            )}
            {data!.topWorkflows.map((w) => (
              <div key={w.name} className="flex items-center justify-between text-[13px]">
                <a href={`#/workflows/${encodeURIComponent(w.name)}`} className="truncate font-medium text-text hover:text-accent">
                  {w.name}
                </a>
                <span className="tabular-nums text-muted">{w.runs} runs</span>
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
            <p className="mt-2 text-[12px] leading-5 text-muted">
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

function ShardBar({ assigned, total }: { assigned: number; total: number }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full border border-border bg-bg">
      <div className="h-full bg-accent transition-all" style={{ width: `${(assigned / total) * 100}%` }} />
    </div>
  )
}
