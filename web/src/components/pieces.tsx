import * as React from "react"
import { SkeletonLine } from "../kumo"
import { TH } from "./ui.tsx"
import { api, type MessageDetail, type MessageStatus } from "../api.ts"
import { relTime } from "../format.ts"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, type StatusTone } from "./ui.tsx"

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
  if (value === null || value === undefined) return <span className="text-kumo-subtle">—</span>
  if (!open && text.length > max) {
    return (
      <div className="flex items-center gap-2">
        <code className="truncate rounded bg-kumo-canvas px-1.5 py-0.5 text-xs">{text.slice(0, max)}…</code>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          more
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <pre className="max-h-64 max-w-full overflow-auto rounded-md border border-kumo-line bg-kumo-base p-2.5 text-xs leading-5">
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
  sub,
  tone,
  href
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: "err" | undefined
  /** when set the whole card deep-links to a filtered view */
  href?: string
}) {
  return (
    <Card
      className={cn(
        tone === "err" && "border-kumo-danger/40",
        href && "cursor-pointer transition-colors hover:border-kumo-brand/50"
      )}
    >
      {href ? (
        <a href={href} className="block outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand/50">
          <StatCardBody label={label} value={value} sub={sub} tone={tone} />
        </a>
      ) : (
        <StatCardBody label={label} value={value} sub={sub} tone={tone} />
      )}
    </Card>
  )
}

function StatCardBody({
  label,
  value,
  sub,
  tone
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: "err" | undefined
}) {
  return (
    <>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold tabular-nums", tone === "err" && "text-kumo-danger")}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[12px] text-kumo-subtle">{sub}</div>}
      </CardContent>
    </>
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
  const panelRef = useDialogA11y(open)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-kumo-line bg-kumo-base p-4 shadow-xl focus:outline-none"
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
    <span className="inline-flex items-center gap-1.5 text-kumo-subtle" title={at ? new Date(at).toLocaleString() : ""}>
      <span className="h-1.5 w-1.5 rounded-full bg-kumo-brand/70" />
      {relTime(at)}
    </span>
  )
}

/* ------------------------------ skeletons -------------------------------- */

/** Keeps skeleton UI visible for >=250ms so fast loads don't flash. */
export function useSkeletonDelay(loading: boolean): boolean {
  const [show, setShow] = React.useState(loading)
  React.useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setShow(false), 250)
      return () => clearTimeout(t)
    }
    setShow(true)
  }, [loading])
  return show && loading
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-kumo-line p-4">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonLine key={c} blockHeight={14} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-kumo-line p-4">
          <SkeletonLine blockHeight={11} maxWidth={40} />
          <SkeletonLine blockHeight={26} maxWidth={30} minDelay={0.1} />
        </div>
      ))}
    </div>
  )
}

/* ---------------------- sorting + deep-linkable filters -------------------- */

export type SortDir = "asc" | "desc"

export interface SortState {
  key: string | null
  dir: SortDir
}

/**
 * Client-side table sorting. No initial state preserves the natural order until
 * the user clicks a header; toggling cycles asc → desc. Null values always
 * sort last regardless of direction.
 *
 * Usage: `const sort = useSort<Row>()` ... `<SortableTh label="X" sortKey="x" sort={sort} />`
 * ... `sort.sorted(rows)` wherever rows are rendered.
 */
export function useSort<T>(initial: SortState | null = null) {
  const [sort, setSort] = React.useState<SortState | null>(initial)

  const toggle = React.useCallback((key: string) => {
    setSort((s) => (s !== null && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))
  }, [])

  const sorted = React.useCallback(
    (rows: ReadonlyArray<T>): T[] => {
      if (!sort?.key) return [...rows]
      const key = sort.key
      const dir = sort.dir === "asc" ? 1 : -1
      return [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[key]
        const bv = (b as Record<string, unknown>)[key]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
        return String(av).localeCompare(String(bv)) * dir
      })
    },
    [sort]
  )

  return { sorted, sortKey: sort?.key ?? null, dir: sort?.dir ?? "asc", toggle }
}

/** Clickable table header wired to useSort; renders the ▲/▼ indicator. */
export function SortableTh({
  label,
  sortKey,
  sort,
  className
}: {
  label: React.ReactNode
  sortKey: string
  sort: { sortKey: string | null; dir: SortDir; toggle: (key: string) => void }
  className?: string
}) {
  const active = sort.sortKey === sortKey
  return (
    <TH
      className={cn("sticky top-0 z-10 bg-kumo-base p-0", active && "text-kumo-default", className)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className="w-full cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-kumo-default"
        title={`sort by ${typeof label === "string" ? label.toLowerCase() : sortKey}`}
      >
        {label}
        <span className="ml-1 inline-block w-2.5 text-[9px] text-kumo-inactive">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </TH>
  )
}

/** Sticky-header classes for plain (non-sortable) TH cells. */
export const STICKY_TH = "sticky top-0 z-10 bg-kumo-base"

/**
 * Dialog a11y for custom overlay panels (UX review P1-6c/P2-14): role=dialog,
 * aria-modal, Tab focus trap, initial focus, focus restore on close, and body
 * scroll lock. Attach the returned ref to the panel content element.
 */
export function useDialogA11y(active: boolean) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const restoreTo = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!active) return
    const node = ref.current
    restoreTo.current = document.activeElement as HTMLElement | null

    const focusables = () => {
      if (!node) return []
      return Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0)
    }
    ;(focusables()[0] ?? node)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node) return
      const list = focusables()
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey, true)
      document.body.style.overflow = prevOverflow
      restoreTo.current?.focus?.()
    }
  }, [active])

  return ref
}

/** Spread onto clickable table rows so keyboard users can open them (P1-6b). */
export function rowInteractions(onOpen: () => void): {
  tabIndex: number
  role: string
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  return {
    tabIndex: 0,
    role: "button",
    onClick: onOpen,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onOpen()
      }
    }
  }
}

/**
 * Deep-linkable filter state backed by the hash query string (#/path?key=value).
 * Writes go through history.replaceState so nothing remounts; external hash
 * changes (nav, back button) stay in sync.
 */
export function useHashParam(key: string): [string, (value: string) => void] {
  const read = React.useCallback(() => {
    const raw = window.location.hash.slice(1)
    const q = raw.indexOf("?")
    if (q === -1) return ""
    return new URLSearchParams(raw.slice(q + 1)).get(key) ?? ""
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const [value, setValue] = React.useState(read)

  React.useEffect(() => {
    const onChange = () => setValue(read())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [read])

  const update = React.useCallback(
    (next: string) => {
      const raw = window.location.hash.slice(1) || "/overview"
      const qIdx = raw.indexOf("?")
      const path = qIdx === -1 ? raw : raw.slice(0, qIdx)
      const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1))
      if (next === "") params.delete(key)
      else params.set(key, next)
      const qs = params.toString()
      window.history.replaceState(null, "", `#${path}${qs ? `?${qs}` : ""}`)
      setValue(next)
    },
    [key]
  )

  return [value, update]
}

/** Removable chip representing an active URL-backed filter. */
export function FilterChip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <Badge tone="info" className="inline-flex items-center gap-1">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`clear filter ${typeof label === "string" ? label : ""}`.trim()}
        onClick={onRemove}
        className="cursor-pointer px-0.5 text-[11px] leading-none opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </Badge>
  )
}
