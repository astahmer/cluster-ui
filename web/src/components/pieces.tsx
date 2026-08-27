import * as React from "react"
import { SkeletonLine } from "../kumo"
import { ArrowsIn, ArrowsOut, CaretDown, CaretRight, X } from "@phosphor-icons/react"
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
  // P2-18: scheduled would collide with pending (both warm hues) — give it a
  // dashed-outline link-colored badge so shape AND hue differ from pending.
  if (status === "scheduled") {
    return (
      <Badge tone="neutral" className="border border-dashed border-kumo-brand bg-transparent !text-kumo-link">
        {status}
      </Badge>
    )
  }
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
      <pre className="min-w-0 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-kumo-line bg-kumo-base p-2.5 text-xs leading-5">
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
  const titleId = React.useId()
  const [width, setWidth] = React.useState(560)
  const [fullscreen, setFullscreen] = React.useState(false)
  const resizing = React.useRef(false)

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (fullscreen) return
    event.currentTarget.setPointerCapture(event.pointerId)
    resizing.current = true
    const startX = event.clientX
    const startWidth = width
    const onMove = (moveEvent: PointerEvent) => {
      if (!resizing.current) return
      setWidth(Math.min(Math.max(startWidth + startX - moveEvent.clientX, 360), Math.min(window.innerWidth, 960)))
    }
    const stop = () => {
      resizing.current = false
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", stop)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex h-full min-w-0 w-full flex-col overflow-x-hidden overflow-y-auto overscroll-contain border-l border-kumo-line bg-kumo-base p-4 shadow-xl focus:outline-none",
          fullscreen && "max-w-none"
        )}
        style={{ width: fullscreen ? "100%" : String(width) + "px", maxWidth: "100vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        {!fullscreen && (
          <div
            role="separator"
            aria-label="Resize detail panel"
            aria-orientation="vertical"
            tabIndex={0}
            className="absolute inset-y-0 left-0 z-10 hidden w-1 cursor-ew-resize bg-transparent transition-colors hover:bg-kumo-brand/50 focus-visible:bg-kumo-brand sm:block"
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setWidth((value) => Math.min(value + 32, Math.min(window.innerWidth, 960)))
              if (event.key === "ArrowRight") setWidth((value) => Math.max(value - 32, 360))
            }}
          />
        )}
        <div className="mb-3 flex min-w-0 shrink-0 items-center justify-between gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 overflow-hidden text-sm font-semibold">{title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={fullscreen ? "Exit fullscreen detail panel" : "Open detail panel fullscreen"}
              title={fullscreen ? "exit fullscreen" : "fullscreen"}
              onClick={() => setFullscreen((value) => !value)}
            >
              {fullscreen ? <ArrowsIn className="h-3.5 w-3.5" /> : <ArrowsOut className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" /> close
            </Button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function useMessageDetail(id: string | null) {
  const [detail, setDetail] = React.useState<MessageDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  React.useEffect(() => {
    let alive = true
    if (!id) {
      setDetail(null)
      setError(null)
      return
    }
    setDetail(null)
    setError(null)
    api.message(id)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [id, retryToken])
  return { detail, error, retry: () => setRetryToken((token) => token + 1) }
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
export function useSort<T>(
  initial: SortState | null = null,
  options?: { urlKey?: string; allowedKeys?: ReadonlyArray<string> }
) {
  const [localSort, setLocalSort] = React.useState<SortState | null>(initial)
  const [urlSortValue, setUrlSortValue] = useHashParam(options?.urlKey ?? "__cluster_ui_local_sort")
  const urlSort = React.useMemo(() => {
    if (!options?.urlKey || !urlSortValue) return null
    const [key, dir] = urlSortValue.split(":")
    if (!key || (dir !== "asc" && dir !== "desc")) return null
    if (options.allowedKeys && !options.allowedKeys.includes(key)) return null
    return { key, dir } as SortState
  }, [options?.allowedKeys, options?.urlKey, urlSortValue])
  const sort = options?.urlKey ? (urlSort ?? localSort) : localSort

  const toggle = React.useCallback((key: string) => {
    const next: SortState = sort !== null && sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    if (options?.urlKey) setUrlSortValue(next.key + ":" + next.dir)
    else setLocalSort(next)
  }, [options?.urlKey, setUrlSortValue, sort])

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
      className={cn(`${STICKY_TH} p-0`, active && "text-kumo-default", className)}
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
        className="-my-1 -mr-1 cursor-pointer p-1 text-[11px] leading-none opacity-70 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  )
}

/** Shared dashed-outline treatment for "scheduled" (UX audit #2 A7) — visually
 * distinct from pending (amber) and inflight (blue info) everywhere. Accepts
 * plain children, a numeric count, or a text label for column use. */
export const SCHEDULED_BADGE_CLASS =
  "border border-dashed border-kumo-brand bg-transparent !text-kumo-link"

export function ScheduledBadge({
  children,
  count,
  label
}: {
  children?: React.ReactNode
  count?: number
  label?: string
}) {
  const content = children ?? (count !== undefined ? String(count) : label) ?? "scheduled"
  return (
    <Badge tone="neutral" className={SCHEDULED_BADGE_CLASS}>
      {content}
    </Badge>
  )
}

/**
 * Shared pager (P2-4): "page x / y" with prev/next. Used by Messages and
 * EntityInstances so paging looks and behaves the same everywhere.
 */
export function Pager({
  page,
  total,
  pageSize,
  onChange
}: {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-kumo-subtle">
      <button
        type="button"
        className="min-h-[28px] cursor-pointer rounded-md border border-kumo-line px-3 py-1 text-[12px] font-medium text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ← prev
      </button>
      <span className="tabular-nums">
        page {page} / {pages}
      </span>
      <button
        type="button"
        className="min-h-[28px] cursor-pointer rounded-md border border-kumo-line px-3 py-1 text-[12px] font-medium text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        next →
      </button>
    </div>
  )
}
