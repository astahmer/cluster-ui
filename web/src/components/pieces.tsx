import * as React from "react"
import { api, type MessageDetail, type MessageStatus } from "../api.ts"
import { relTime } from "../format.ts"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type StatusTone } from "./ui.tsx"

export const statusTone: Record<MessageStatus, StatusTone> = {
  pending: "warn",
  inflight: "info",
  scheduled: "accent",
  done: "ok"
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  return <Badge tone={statusTone[status]}>{status}</Badge>
}

export function JsonBlock({ value, max = 400 }: { value: unknown; max?: number }) {
  const [open, setOpen] = React.useState(false)
  const text = React.useMemo(() => JSON.stringify(value, null, 2) ?? "—", [value])
  if (value === null || value === undefined) return <span className="text-muted">—</span>
  if (!open && text.length > max) {
    return (
      <div className="flex items-center gap-2">
        <code className="truncate rounded bg-bg px-1.5 py-0.5 text-xs">{text.slice(0, max)}…</code>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          more
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <pre className="max-h-64 max-w-full overflow-auto rounded-md border border-border bg-bg p-2.5 text-xs leading-5">
        {text}
      </pre>
      {text.length > max && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          less
        </Button>
      )}
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
      </CardContent>
    </Card>
  )
}

/** Side panel used for message + workflow-run details */
export function DetailPanel({
  open,
  onClose,
  title,
  children
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕ close
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function useMessageDetail(id: string | null) {
  const [detail, setDetail] = React.useState<MessageDetail | null>(null)
  React.useEffect(() => {
    let alive = true
    if (!id) {
      setDetail(null)
      return
    }
    api.message(id).then((d) => alive && setDetail(d))
    return () => {
      alive = false
    }
  }, [id])
  return detail
}

export function ActivityDot({ at }: { at: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted" title={at ? new Date(at).toLocaleString() : ""}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent/70" />
      {relTime(at)}
    </span>
  )
}
