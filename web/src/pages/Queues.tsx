import * as React from "react"
import { QueueIcon } from "@phosphor-icons/react"
import { api, type QueueInfo } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Empty, Tooltip } from "../kumo"
import { SkeletonTable } from "../components/pieces.tsx"
import { Button } from "../components/ui.tsx"
import { toast } from "../toast.tsx"
import { confirmDialog } from "../components/dialogs.tsx"

/**
 * Queue controls (redis/BullMQ clusters): pause/resume intake per queue.
 * Sqlite clusters render the redis-only empty state.
 */
export function QueuesPage() {
  const [queues, setQueues] = React.useState<QueueInfo[]>([])
  const { loading, error, refresh } = useLive(async () => setQueues(await api.queues()))

  if (loading && queues.length === 0) return <SkeletonTable />

  const pausedCount = queues.filter((q) => q.paused).length

  const toggle = async (queue: QueueInfo) => {
    const pausing = !queue.paused
    if (
      pausing &&
      !(await confirmDialog({
        title: `Pause queue "${queue.name}"?`,
        description: "New jobs stay in wait; workers stop picking them up until resumed.",
        destructive: true,
        confirmLabel: "Pause"
      }))
    )
      return
    try {
      if (pausing) await api.pauseQueue(queue.name)
      else await api.resumeQueue(queue.name)
      toast.success(pausing ? `Queue ${queue.name} paused` : `Queue ${queue.name} resumed`)
      refresh()
    } catch (e) {
      toast.error(`${pausing ? "Pause" : "Resume"} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div>
      <PageHeader
        title="Queues"
        subtitle="redis queue intake controls — pause stops workers from taking new jobs"
      />
      <ErrorNote error={error} onRetry={refresh} />

      {queues.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-kumo-subtle">
          <Badge tone={pausedCount > 0 ? "warn" : "ok"}>
            {queues.length - pausedCount}/{queues.length} active
          </Badge>
          {pausedCount > 0 && <Badge tone="warn">{pausedCount} paused</Badge>}
        </div>
      )}

      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Queue</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {queues.map((q) => (
              <TR key={q.name}>
                <TD className="font-medium">{q.name}</TD>
                <TD>{q.paused ? <Badge tone="warn">paused</Badge> : <Badge tone="ok">active</Badge>}</TD>
                <TD className="text-right">
                  <Button variant={q.paused ? "secondary" : "ghost"} size="sm" onClick={() => void toggle(q)}>
                    {q.paused ? "Resume" : "Pause"}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {queues.length === 0 && (
          <Empty
            icon={<QueueIcon className="h-8 w-8 text-kumo-subtle" />}
            title="No queues — this cluster isn't redis-backed"
            description="Queue controls apply to BullMQ clusters. Add one via CLUSTER_UI_CLUSTERS=name=redis://host:6399."
          />
        )}
      </div>

      {queues.length === 0 && (
        <p className="mt-2 flex items-center gap-1 text-[12px] text-kumo-subtle">
          redis clusters expose queue pause/resume here; sqlite clusters manage delivery through the
          cluster itself.
          <Tooltip content="CLUSTER_UI_CLUSTERS=name=redis://127.0.0.1:6399">
            <span className="cursor-help underline underline-offset-2">how?</span>
          </Tooltip>
        </p>
      )}
    </div>
  )
}
