import * as React from "react"
import { SquaresFour, Cpu, GridFour, Cube, ClockCounterClockwise, FlowArrow, ListDashes, CirclesThree, List, Stack, Sparkle } from "@phosphor-icons/react"
import { api } from "./api.ts"
import * as live from "./live.ts"
import { useFreshness } from "./freshness.ts"
import { inputVariants } from "./kumo"
import { CommandPalette, type PaletteItem } from "./components/command-palette.tsx"
import { Badge } from "./components/ui.tsx"
import { cn } from "./components/ui.tsx"

/* ------------------------------ hash routing ------------------------------ */

export interface Route {
  /** path portion of the hash, e.g. "/messages" */
  path: string
  params: URLSearchParams
  segments: string[]
}

function parseHash(): Route {
  const raw = window.location.hash.slice(1) || "/overview"
  const q = raw.indexOf("?")
  const path = q === -1 ? raw : raw.slice(0, q)
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1))
  return { path, params, segments: path.split("/").filter(Boolean) }
}

/** Full route info including query-string-style params after "?" in the hash. */
export function useRoute(): Route {
  const [route, setRoute] = React.useState(parseHash)
  React.useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return route
}

export function navigate(path: string) {
  window.location.hash = path
}

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
}

export function Link({ to, className, ...props }: LinkProps) {
  return <a href={`#${to}`} className={className} {...props} />
}

/* ------------------------------- live refresh ----------------------------- */

export { useLive, isPaused, triggerRefresh } from "./live.ts"

export const usePolling = live.useLive

/**
 * Registers a handler fired when the user presses Escape anywhere.
 * Detail panels/modals use this to close themselves.
 */
export function useEscToClose(handler: () => void) {
  const ref = React.useRef(handler)
  ref.current = handler
  React.useEffect(() => {
    const fn = () => ref.current()
    window.addEventListener("ui:esc", fn)
    return () => window.removeEventListener("ui:esc", fn)
  }, [])
}

/* --------------------------------- theming -------------------------------- */
// kumo flips light/dark via `data-mode` on :root; `data-theme="kumo"` scopes tokens.
const THEME_KEY = "cluster_ui_theme"

function applyTheme(mode: string) {
  document.documentElement.dataset.mode = mode
  if (!document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = "kumo"
  }
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {}
}

function initialTheme(): string {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {}
  if (stored !== null) return stored
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

/* --------------------------------- layout --------------------------------- */

const NAV = [
  { to: "/overview", label: "Overview", icon: SquaresFour },
  { to: "/runners", label: "Runners", icon: Cpu },
  { to: "/shards", label: "Shards", icon: GridFour },
  { to: "/entities", label: "Entities", icon: Cube },
  { to: "/workflows", label: "Workflows", icon: FlowArrow },
  { to: "/crons", label: "Crons", icon: ClockCounterClockwise },
  { to: "/traces", label: "Traces", icon: Stack },
  { to: "/singletons", label: "Singletons", icon: CirclesThree },
  { to: "/messages", label: "Messages", icon: ListDashes },
  { to: "/agent", label: "Agent", icon: Sparkle }
]

const NAV_GROUP_CLUSTER = new Set(["/overview", "/runners", "/shards"])
const NAV_GROUP_WORK = new Set(["/entities", "/workflows", "/crons", "/traces", "/singletons", "/messages"])

function FreshnessIndicator() {
  const { secondsAgo } = useFreshness()
  if (secondsAgo === null) return null
  const stale = secondsAgo > 15
  return (
    <span
      className={cn("hidden text-[11px] tabular-nums sm:inline", stale ? "text-kumo-warning" : "text-kumo-inactive")}
      title={stale ? "no successful refresh recently" : "last successful refresh"}
    >
      updated {secondsAgo}s ago
    </span>
  )
}

function TopBar({ base, onMenu }: { base: string; onMenu: () => void }) {
  void base
  const [paused, togglePausedState] = live.usePaused()
  const [clusters, setClusters] = React.useState<string[]>([])
  const [cluster, setClusterState] = React.useState<string | null>(null)

  React.useEffect(() => {
    api
      .config()
      .then((cfg) => {
        if (cfg.clusters.length > 1) {
          setClusters(cfg.clusters)
          const stored = localStorage.getItem("cluster_ui_cluster")
          setClusterState(stored && cfg.clusters.includes(stored) ? stored : cfg.clusters[0])
        }
      })
      .catch(() => {})
  }, [])

  // keep in sync when another tab changes it
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cluster_ui_cluster") setClusterState(e.newValue)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const pickTheme = () => {
    const next =
      (document.documentElement.dataset.mode ?? initialTheme()) === "dark" ? "light" : "dark"
    applyTheme(next)
  }

  return (
    <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-kumo-line bg-kumo-base px-4">
      <button
        type="button"
        onClick={onMenu}
        aria-label="open navigation menu"
        className="mr-auto grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default lg:hidden"
      >
        <List weight="bold" className="h-4 w-4" />
      </button>

      <FreshnessIndicator />

      {clusters.length > 1 && (
        <select
          aria-label="cluster"
          className={cn(inputVariants({ size: "xs" }), "h-7 cursor-pointer")}
          value={cluster ?? clusters[0]}
          onChange={(e) => {
            localStorage.setItem("cluster_ui_cluster", e.target.value)
            setClusterState(e.target.value)
            live.triggerRefresh()
          }}
        >
          {clusters.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={() => togglePausedState(!paused)}
        title={paused ? "resume auto-refresh" : "pause auto-refresh"}
        aria-label={paused ? "resume auto-refresh" : "pause auto-refresh"}
      >
        <Badge tone={paused ? "warn" : "ok"}>{paused ? "paused" : "live"}</Badge>
      </button>

      <button
        type="button"
        onClick={pickTheme}
        title="toggle light/dark"
        aria-label="toggle light/dark theme"
        className="grid h-7 w-7 place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default cursor-pointer"
      >
        ◐
      </button>

      {/* hidden marker keeps keyboard shortcut logic aware of current section */}
      <span data-active-section={base} className="hidden" />
    </div>
  )
}

export function Shell({ route, children }: { route: string; children: React.ReactNode }) {
  const base = "/" + (route.split("?")[0].split("/")[1] ?? "overview")
  const [navOpen, setNavOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)

  // ⌘K / Ctrl+K opens the command palette
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const paletteItems = React.useMemo<PaletteItem[]>(
    () =>
      NAV.map((n) => ({
        key: n.to,
        label: `Go to ${n.label}`,
        keywords: n.to,
        hint: String(NAV.findIndex((x) => x.to === n.to) + 1),
        run: () => navigate(n.to)
      })),
    []
  )
  const dynamicItems = React.useCallback(
    (query: string): PaletteItem[] => {
      // all-digit snowflake id → deep link into messages search
      if (!/^\d{10,}$/.test(query)) return []
      return [
        {
          key: "open-message",
          label: `Open message ${query}`,
          keywords: "message id search",
          run: () => navigate(`/messages?q=${encodeURIComponent(query)}`)
        }
      ]
    },
    []
  )

  // close the mobile drawer whenever the route changes
  React.useEffect(() => {
    setNavOpen(false)
  }, [route])

  // theme bootstrap
  React.useEffect(() => {
    applyTheme(initialTheme())
  }, [])

  // global keyboard shortcuts: 1..N nav sections, "/" search, Esc close
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("ui:esc"))
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "/") {
        e.preventDefault()
        ;(document.querySelector("[data-search-input]") as HTMLInputElement | null)?.focus()
        return
      }
      const idx = Number(e.key)
      if (Number.isInteger(idx) && idx >= 1 && idx <= NAV.length) {
        navigate(NAV[idx - 1].to)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
    <ShellLayout base={base} navOpen={navOpen} onMenu={() => setNavOpen(true)} onNavClose={() => setNavOpen(false)}>
      {children}
    </ShellLayout>
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      staticItems={paletteItems}
      dynamicItems={dynamicItems}
    />
    </>
  )
}

function ShellLayout({
  base,
  navOpen,
  onMenu,
  onNavClose,
  children
}: {
  base: string
  navOpen: boolean
  onMenu: () => void
  onNavClose: () => void
  children: React.ReactNode
}) {
  const [busDown, setBusDownState] = React.useState(live.isBusDown())
  React.useEffect(() => live.onBusDownChange(setBusDownState), [])

  return (
    <div className="flex h-full">
      {/* desktop sidebar */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-kumo-line bg-kumo-elevated lg:flex">
        <SidebarContent base={base} />
      </aside>

      {/* mobile off-canvas drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={onNavClose}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-kumo-line bg-kumo-base shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent base={base} onNavigate={onNavClose} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar base={base} onMenu={onMenu} />
        {busDown && (
          <div className="border-b border-kumo-warning/30 bg-kumo-warning-tint px-4 py-1.5 text-[12px] text-kumo-warning">
            Live updates unavailable — retrying…
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({ base, onNavigate }: { base: string; onNavigate?: () => void }) {
  React.useEffect(() => {
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNavigate?.()
    }
    window.addEventListener("keydown", closeOnEsc)
    return () => window.removeEventListener("keydown", closeOnEsc)
  }, [onNavigate])

  return (
    <>
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-kumo-brand text-sm font-bold !text-white">
            c
          </span>
          <div>
            <div className="text-sm font-semibold leading-4 text-kumo-default">cluster-ui</div>
            <div className="text-[11px] text-kumo-subtle">effect v4 dashboard</div>
          </div>
        </div>
        <nav className="mt-2 flex flex-1 flex-col gap-4 px-2">
          <NavGroup label="Cluster" base={base} items={NAV.filter((n) => NAV_GROUP_CLUSTER.has(n.to))} onNavigate={onNavigate} />
          <NavGroup label="Work" base={base} items={NAV.filter((n) => NAV_GROUP_WORK.has(n.to))} onNavigate={onNavigate} />
        </nav>
        <div className="border-t border-kumo-line px-4 py-3 text-[11px] leading-4 text-kumo-subtle">
          reads the cluster's SQL storage
          <br />
          <span className="text-kumo-inactive">1–{NAV.length} switch · / search · esc close</span>
        </div>
    </>
  )
}

function NavGroup({
  label,
  base,
  items,
  onNavigate
}: {
  label: string
  base: string
  items: typeof NAV
  onNavigate?: () => void
}) {
  return (
    <div>
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-kumo-inactive">
        {label}
      </div>
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon
          const active = base === item.to
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer",
                active
                  ? "bg-kumo-tint text-kumo-default"
                  : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
              )}
            >
              <Icon
                weight={active ? "fill" : "regular"}
                className={cn("h-4 w-4 shrink-0", active ? "text-kumo-brand" : "opacity-80")}
              />
              <span className="flex-1">{item.label}</span>
              <kbd className="hidden text-[10px] text-kumo-inactive group-hover:inline">
                {NAV.findIndex((n) => n.to === item.to) + 1}
              </kbd>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/* ------------------------------ page helpers ------------------------------ */

export function PageHeader({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-kumo-default">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-kumo-subtle">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-kumo-danger/30 bg-kumo-danger-tint px-3 py-2 text-[13px] text-kumo-danger">
      <span>{error}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 cursor-pointer rounded-md border border-kumo-danger/40 px-2 py-0.5 text-[12px] font-medium hover:bg-kumo-danger-tint"
        >
          Retry
        </button>
      )}
    </div>
  )
}
