import * as React from "react"
import { QueueIcon } from "@phosphor-icons/react"
import { api, type QueueInfo } from "../api.ts"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Empty, Tooltip, Dialog, DialogTitle, DialogDescription } from "../kumo"
import { SkeletonTable } from "../components/pieces.tsx"
import { Button, Input, Select } from "../components/ui.tsx"
import { toast } from "../toast.tsx"
import { confirmDialog } from "../components/dialogs.tsx"
import { useAppConfig } from "../config.ts"

/**
 * Queue controls (redis/BullMQ clusters): pause/resume intake per queue,
 * add jobs, clean completed/failed. Sqlite clusters render the redis-only
 * empty state. (UX review P1-3)
 */
export function QueuesPage() {
  const [queues, setQueues] = React.useState<QueueInfo[]>([])
  const { loading, error, refresh } = useLive(async () => setQueues(await api.queues()))
  const [addFor, setAddFor] = React.useState<string | null>(null)
  const [cleanFor, setCleanFor] = React.useState<QueueInfo | null>(null)
  const config = useAppConfig()
  const readonly = config?.readonly === true

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
        subtitle="redis queue intake — pause stops workers from taking new jobs; clean removes finished jobs"
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
              <TH className="text-right">Waiting</TH>
              <TH className="text-right">Active</TH>
              <TH className="text-right">Completed</TH>
              <TH className="text-right">Failed</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {queues.map((q) => (
              <TR key={q.name}>
                <TD className="font-medium">{q.name}</TD>
                <TD>{q.paused ? <Badge tone="warn">paused</Badge> : <Badge tone="ok">active</Badge>}</TD>
                <TD className="text-right tabular-nums">
                  <Tooltip content={`${q.counts?.waiting ?? 0} waiting · ${q.counts?.delayed ?? 0} delayed`}>
                    <span className="cursor-help underline decoration-dotted underline-offset-2">
                      {q.counts?.waiting ?? "—"}
                    </span>
                  </Tooltip>
                </TD>
                <TD className="text-right tabular-nums">{q.counts?.active ?? "—"}</TD>
                <TD className="text-right tabular-nums text-kumo-subtle">{q.counts?.completed ?? "—"}</TD>
                <TD className={"text-right tabular-nums " + ((q.counts?.failed ?? 0) > 0 ? "text-kumo-danger" : "text-kumo-subtle")}>
                  {q.counts?.failed ?? "—"}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readonly}
                      title={readonly ? "read-only mode" : undefined}
                      onClick={() => setAddFor(q.name)}
                    >
                      Add job
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readonly}
                      title={readonly ? "read-only mode" : undefined}
                      onClick={() => setCleanFor(q)}
                    >
                      Clean…
                    </Button>
                    <Button
                      variant={q.paused ? "secondary" : "ghost"}
                      size="sm"
                      disabled={readonly}
                      title={readonly ? "read-only mode" : undefined}
                      onClick={() => void toggle(q)}
                    >
                      {q.paused ? "Resume" : "Pause"}
                    </Button>
                  </div>
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

      {addFor !== null && (
        <AddJobDialog
          queue={addFor}
          onClose={() => setAddFor(null)}
          onDone={(id) => {
            setAddFor(null)
            toast.success(`Job added to ${addFor}: ${id}`)
            refresh()
          }}
        />
      )}
      {cleanFor !== null && (
        <CleanDialog
          queue={cleanFor}
          onClose={() => setCleanFor(null)}
          onDone={(removed) => {
            setCleanFor(null)
            toast.success(`Removed ${removed} job${removed === 1 ? "" : "s"} from ${cleanFor.name}`)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/** Add-job form: name + JSON payload → bullmq-compatible job on the wait list. */
function AddJobDialog({
  queue,
  onClose,
  onDone
}: {
  queue: string
  onClose: () => void
  onDone: (id: string) => void
}) {
  const [name, setName] = React.useState("manual")
  const [dataText, setDataText] = React.useState("{}")
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const submit = async () => {
    let data: unknown
    try {
      data = dataText.trim() === "" ? {} : JSON.parse(dataText)
    } catch {
      setErr("data is not valid JSON")
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await api.addJob(queue, name.trim() || "manual", data)
      onDone(res.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog className="p-6">
        <DialogTitle>Add job to "{queue}"</DialogTitle>
        <DialogDescription>Creates a minimal BullMQ-compatible job on the wait list.</DialogDescription>
        <div className="mt-4 space-y-3">
          <Input aria-label="job name" placeholder="job name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea
            aria-label="job data (JSON)"
            className="min-h-28 w-full rounded-md border border-kumo-line bg-kumo-canvas p-2 font-mono text-[12px] text-kumo-default focus:border-kumo-brand focus:outline-none"
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
          />
          {err && <p className="text-[12px] text-kumo-danger">{err}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close render={(p) => (
            <Button variant="secondary" {...(p as object)} onClick={onClose}>
              Cancel
            </Button>
          )} />
          <Button variant="default" disabled={busy} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add job"}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

/** Clean form: pick which terminal states to purge, optionally scoped by age/count. */
function CleanDialog({
  queue,
  onClose,
  onDone
}: {
  queue: QueueInfo
  onClose: () => void
  onDone: (removed: number) => void
}) {
  const [scope, setScope] = React.useState<"completed" | "failed" | "*">("completed")
  const [olderMin, setOlderMin] = React.useState("")
  const [count, setCount] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const failedCount = queue.counts?.failed ?? 0
  const completedCount = queue.counts?.completed ?? 0

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.cleanQueue(queue.name, scope, {
        olderThanMs: olderMin.trim() !== "" ? Number(olderMin) * 60_000 : undefined,
        count: count.trim() !== "" ? Number(count) : undefined
      })
      onDone(res.removed)
    } catch (e) {
      toast.error(`Clean failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const confirmAndSubmit = async () => {
    const scopeLabel =
      scope === "*" ? "completed AND failed" : scope
    const ok = await confirmDialog({
      title: `Remove ${scopeLabel} jobs from "${queue.name}"?`,
      description: `Up to ${count.trim() !== "" ? count : 500} jobs, oldest first${
        olderMin.trim() !== "" ? ` (older than ${olderMin}m)` : ""
      }. Currently ${completedCount} completed · ${failedCount} failed. This cannot be undone.`,
      destructive: true,
      confirmLabel: "Remove jobs"
    })
    if (ok) void submit()
  }

  return (
    <Dialog.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog className="p-6">
        <DialogTitle>Clean "{queue.name}"</DialogTitle>
        <DialogDescription>
          Removes finished jobs oldest-first ({completedCount} completed · {failedCount} failed right now).
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <Select
            aria-label="which jobs to remove"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="completed">completed only</option>
            <option value="failed">failed only</option>
            <option value="*">both completed and failed</option>
          </Select>
          <div className="flex gap-2">
            <Input
              aria-label="older than minutes"
              type="number"
              min="0"
              placeholder="older than (minutes)"
              value={olderMin}
              onChange={(e) => setOlderMin(e.target.value)}
            />
            <Input
              aria-label="max jobs to remove"
              type="number"
              min="1"
              max="1000"
              placeholder="max count (default 500)"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close render={(p) => (
            <Button variant="secondary" {...(p as object)} onClick={onClose}>
              Cancel
            </Button>
          )} />
          <Button variant="danger" disabled={busy} onClick={() => void confirmAndSubmit()}>
            {busy ? "Cleaning…" : "Remove jobs"}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
