import * as React from "react"
import { SquaresFour, Cpu, GridFour, Cube, ClockCounterClockwise, FlowArrow, ListDashes, CirclesThree, List, Stack, Sparkle, Plugs, MagnifyingGlass, QueueIcon, Moon, Sun } from "@phosphor-icons/react"
import { api, getCluster, onClusterChange, setCluster } from "./api.ts"
import { useAppConfig } from "./config.ts"
import { toast } from "./toast.tsx"
import * as live from "./live.ts"
import { useFreshness } from "./freshness.ts"
import { inputVariants } from "./kumo"
import { CommandPalette, type AsyncPaletteProvider, type PaletteItem } from "./components/command-palette.tsx"
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

/**
 * Current cluster (localStorage-backed) as reactive state; updates on
 * same-tab setCluster() calls and cross-tab storage events.
 */
export function useCluster(): string | null {
  const [cluster, setState] = React.useState<string | null>(getCluster)
  React.useEffect(() => {
    const off = onClusterChange(setState)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cluster_ui_cluster") setState(e.newValue)
    }
    window.addEventListener("storage", onStorage)
    return () => {
      off()
      window.removeEventListener("storage", onStorage)
    }
  }, [])
  return cluster
}

/**
 * Provider-side narrowing for palette async sources; final fuzzy ranking
 * happens inside the palette.
 */
function fuzzyIncludes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase())
}

/** Set a single query param on the current hash path without navigating. */
function replaceHashParam(key: string, value: string | null) {
  const raw = window.location.hash.slice(1) || "/overview"
  const qIdx = raw.indexOf("?")
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx)
  const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1))
  if (value === null || value === "") params.delete(key)
  else params.set(key, value)
  const qs = params.toString()
  window.history.replaceState(null, "", `#${path}${qs ? `?${qs}` : ""}`)
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
 * Handlers form a LIFO stack (P2-9): one Esc closes only the most recently
 * opened surface instead of every open panel at once.
 */
const escStack: Array<() => void> = []
export function useEscToClose(handler: () => void) {
  const ref = React.useRef(handler)
  ref.current = handler
  React.useEffect(() => {
    const fn = () => ref.current()
    escStack.push(fn)
    return () => {
      const i = escStack.indexOf(fn)
      if (i >= 0) escStack.splice(i, 1)
    }
  }, [])
}

/* --------------------------------- theming -------------------------------- */
// kumo flips light/dark via `data-mode` on :root; `data-theme="kumo"` scopes tokens.
const THEME_KEY = "cluster_ui_theme"

function applyTheme(mode: string) {
  // "system" clears the stored override and follows prefers-color-scheme (P2-13)
  const effective = mode === "system" ? initialSystemTheme() : mode
  document.documentElement.dataset.mode = effective
  if (!document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = "kumo"
  }
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, mode)
  } catch {}
  // reactive consumers (TopBar icon, palette) re-render on this
  window.dispatchEvent(new CustomEvent("ui:theme"))
}

function initialSystemTheme(): string {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

/** Resolved current mode ("light"|"dark") as reactive state — updates on applyTheme. */
function useThemeMode(): "light" | "dark" {
  const resolve = (): "light" | "dark" =>
    (document.documentElement.dataset.mode ?? initialTheme()) === "light" ? "light" : "dark"
  const [mode, setMode] = React.useState(resolve)
  React.useEffect(() => {
    const sync = () => setMode(resolve())
    window.addEventListener("ui:theme", sync)
    return () => window.removeEventListener("ui:theme", sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return mode
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
  { to: "/queues", label: "Queues", icon: QueueIcon },
  { to: "/entities", label: "Entities", icon: Cube },
  { to: "/workflows", label: "Workflows", icon: FlowArrow },
  { to: "/crons", label: "Crons", icon: ClockCounterClockwise },
  { to: "/traces", label: "Traces", icon: Stack },
  { to: "/singletons", label: "Runtime", icon: CirclesThree },
  { to: "/messages", label: "Messages", icon: ListDashes },
  { to: "/agent", label: "AI Chat", icon: Sparkle },
  { to: "/mcp", label: "MCP", icon: Plugs }
]

/** IA regroup (UX review): Work had 7 entries — split into balanced groups. */
const NAV_GROUPS: Array<{ label: string; paths: string[] }> = [
  { label: "Cluster", paths: ["/overview"] },
  { label: "Infra", paths: ["/runners", "/shards", "/queues"] },
  { label: "Work", paths: ["/entities", "/workflows", "/crons"] },
  { label: "Observe", paths: ["/traces", "/singletons", "/messages"] },
  { label: "Tools", paths: ["/agent", "/mcp"] }
]

function FreshnessIndicator() {
  const { secondsAgo } = useFreshness()
  if (secondsAgo === null) return null
  const stale = secondsAgo > 15
  const title = stale ? "no successful refresh recently" : "last successful refresh"
  return (
    <>
      {/* mobile: icon-only freshness dot (P1-12) */}
      <span
        aria-hidden="true"
        title={title}
        className={cn("inline-block h-2 w-2 rounded-full sm:hidden", stale ? "bg-kumo-warning" : "bg-kumo-success")}
      />
      <span
        className={cn("hidden text-[11px] tabular-nums sm:inline", stale ? "text-kumo-warning" : "text-kumo-subtle")}
        title={title}
      >
        updated {secondsAgo}s ago
      </span>
    </>
  )
}

/** Thin indeterminate activity bar shown while any API request is in flight (P1-12). */
function NetActivityBar() {
  const [pending, setPending] = React.useState(0)
  React.useEffect(() => {
    const onNet = (e: Event) => {
      const delta = (e as CustomEvent).detail?.delta ?? 0
      setPending((n) => Math.max(0, n + delta))
    }
    window.addEventListener("ui:net", onNet)
    return () => window.removeEventListener("ui:net", onNet)
  }, [])
  if (pending === 0) return null
  return (
    <div
      role="progressbar"
      aria-label="loading data"
      className="h-0.5 w-full overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-[net-slide_1s_ease-in-out_infinite] bg-kumo-brand/70" />
    </div>
  )
}

function TopBar({ base, onMenu, onOpenPalette }: { base: string; onMenu: () => void; onOpenPalette: () => void }) {
  void base
  const [paused, togglePausedState] = live.usePaused()
  const [clusters, setClusters] = React.useState<string[]>([])
  const cluster = useCluster()
  const config = useAppConfig()
  const themeMode = useThemeMode()

  React.useEffect(() => {
    api
      .config()
      .then((cfg) => {
        if (cfg.clusters.length > 1) {
          setClusters(cfg.clusters)
          // a shared/bookmarked link carries ?cluster= in the hash — adopt it
          // (UX review P1-2); otherwise keep the stored choice, else first.
          const fromHash = new URLSearchParams(
            window.location.hash.split("?")[1] ?? ""
          ).get("cluster")
          const stored = getCluster()
          if (fromHash && cfg.clusters.includes(fromHash)) {
            if (fromHash !== stored) {
              setCluster(fromHash)
              live.triggerRefresh()
            }
            replaceHashParam("cluster", fromHash)
          } else if (!stored || !cfg.clusters.includes(stored)) {
            setCluster(cfg.clusters[0])
            replaceHashParam("cluster", cfg.clusters[0])
          }
        }
      })
      .catch(() => {})
  }, [])

  // keep the hash param in sync so URLs are shareable per-cluster
  React.useEffect(() => {
    if (clusters.length > 1 && cluster !== null) replaceHashParam("cluster", cluster)
  }, [clusters, cluster])

  const pickTheme = () => {
    const next = (document.documentElement.dataset.mode ?? initialTheme()) === "dark" ? "light" : "dark"
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

      {/* A6: palette is the only id-deep-link entry point — give touch devices an affordance */}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="open command palette"
        className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default sm:hidden"
      >
        <MagnifyingGlass className="h-4 w-4" />
      </button>

      <FreshnessIndicator />

      {/* centered command-palette trigger */}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="open command palette"
        className="mx-auto hidden w-full max-w-md cursor-pointer items-center gap-2 rounded-md border border-kumo-line bg-kumo-canvas px-3 py-1 text-left text-[12px] text-kumo-inactive hover:border-kumo-brand/50 sm:flex"
      >
        <MagnifyingGlass className="h-3.5 w-3.5" />
        <span className="flex-1">Search or jump to…</span>
        <kbd className="rounded border border-kumo-line px-1 text-[10px]">⌘K</kbd>
      </button>

      {clusters.length > 1 && (
        <select
          aria-label="cluster"
          className={cn(inputVariants({ size: "xs" }), "h-7 cursor-pointer")}
          value={cluster ?? clusters[0]}
          onChange={(e) => {
            setCluster(e.target.value)
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

      {config?.readonly && (
        <Badge tone="warn" title="read-only mode — write actions are disabled server-side">
          read-only
        </Badge>
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
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
      >
        {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
  const [clusterNames, setClusterNames] = React.useState<string[]>([])
  // reactive so the palette label reflects the current paused state (audit: stale derived state)
  const [livePaused] = live.usePaused()

  React.useEffect(() => {
    api
      .config()
      .then((cfg) => setClusterNames(cfg.clusters ?? []))
      .catch(() => {})
  }, [])

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
    () => [
      ...NAV.map((n) => ({
        key: n.to,
        label: `Go to ${n.label}`,
        keywords: n.to,
        hint: NAV.findIndex((x) => x.to === n.to) < 9 ? String(NAV.findIndex((x) => x.to === n.to) + 1) : undefined,
        run: () => navigate(n.to)
      })),
      // cluster switching as first-class commands (P1-11 / P1-2); the current
      // cluster is filtered out so only actual switches are offered
      ...clusterNames
        .filter((name) => name !== getCluster())
        .map((name) => ({
          key: `cluster-${name}`,
          label: `Switch to cluster ${name}`,
          keywords: "cluster switch change environment",
          run: () => {
            setCluster(name)
            live.triggerRefresh()
            toast.success(`Switched to cluster ${name}`)
          }
        })),
      {
        key: "theme-toggle",
        label: "Theme: toggle light/dark",
        keywords: "appearance switch mode",
        run: () =>
          applyTheme(
            (document.documentElement.dataset.mode ?? initialTheme()) === "dark" ? "light" : "dark"
          )
      },
      {
        key: "theme-system",
        label: "Theme: follow system",
        keywords: "appearance system default automatic",
        run: () => applyTheme("system")
      },
      {
        key: "live-pause-toggle",
        label: livePaused ? "Live refresh: resume" : "Live refresh: pause",
        keywords: "auto-refresh polling pause resume",
        run: () => live.setPaused(!live.isPaused())
      }
    ],
    [clusterNames, livePaused]
  )
  const dynamicItems = React.useCallback(
    (query: string): PaletteItem[] => {
      const items: PaletteItem[] = []
      // all-digit snowflake id → deep link into messages search
      if (/^\d{10,}$/.test(query)) {
        items.push({
          key: "open-message",
          label: `Open message ${query}`,
          keywords: "message id search",
          run: () => navigate(`/messages?q=${encodeURIComponent(query)}`)
        })
      }
      // hex-ish trace id → trace detail route (P1-15)
      if (/^[0-9a-f]{8,64}$/i.test(query)) {
        items.push({
          key: "open-trace",
          label: `Open trace ${query.slice(0, 16)}${query.length > 16 ? "…" : ""}`,
          keywords: "trace id search",
          run: () => navigate(`/traces/${encodeURIComponent(query)}`)
        })
      }
      return items
    },
    []
  )

  // P1-11: domain-object providers — entities and workflows, debounced +
  // cached inside the palette, fetched only while it is open
  const asyncProviders = React.useMemo<AsyncPaletteProvider[]>(
    () => [
      {
        key: "entities",
        fetch: async (q) => {
          const all = await api.entities()
          return all
            .filter((e) => fuzzyIncludes(e.entityType, q))
            .slice(0, 5)
            .map((e) => ({
              key: `entity-${e.entityType}`,
              label: `Open entity ${e.entityType}`,
              subtitle: `${e.entities} instance${e.entities === 1 ? "" : "s"} · ${e.messages} messages`,
              keywords: "entity instances messages",
              run: () => navigate(`/entities/${encodeURIComponent(e.entityType)}`)
            }))
        }
      },
      {
        key: "workflows",
        fetch: async (q) => {
          const all = await api.workflows()
          return all
            .filter((w) => fuzzyIncludes(w.name, q))
            .slice(0, 5)
            .map((w) => ({
              key: `workflow-${w.name}`,
              label: `Open workflow ${w.name}`,
              subtitle: `${w.runs} runs${w.failedRuns ? ` · ${w.failedRuns} failed` : ""}`,
              keywords: "workflow executions",
              run: () => navigate(`/workflows/${encodeURIComponent(w.name)}`)
            }))
        }
      }
    ],
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
        // only the topmost Esc surface closes (P2-9)
        escStack[escStack.length - 1]?.()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "/") {
        e.preventDefault()
        const search = document.querySelector("[data-search-input]") as HTMLInputElement | null
        if (search) search.focus()
        else setPaletteOpen(true)
        return
      }
      const idx = Number(e.key)
      if (Number.isInteger(idx) && idx >= 1 && idx <= Math.min(NAV.length, 9)) {
        navigate(NAV[idx - 1].to)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
    <ShellLayout
      base={base}
      navOpen={navOpen}
      onMenu={() => setNavOpen(true)}
      onNavClose={() => setNavOpen(false)}
      onOpenPalette={() => setPaletteOpen(true)}
    >
      {children}
    </ShellLayout>
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      staticItems={paletteItems}
      dynamicItems={dynamicItems}
      asyncProviders={asyncProviders}
    />
    </>
  )
}

/** Page content dims slightly while auto-refresh is paused (P1-12). */
function PausedAwareMain({ children }: { children: React.ReactNode }) {
  const [paused] = live.usePaused()
  return (
    <main className={cn("min-h-0 flex-1 overflow-y-auto p-5 transition-opacity", paused && "opacity-70")}>
      {children}
    </main>
  )
}

function ShellLayout({
  base,
  navOpen,
  onMenu,
  onNavClose,
  onOpenPalette,
  children
}: {
  base: string
  navOpen: boolean
  onMenu: () => void
  onNavClose: () => void
  onOpenPalette: () => void
  children: React.ReactNode
}) {
  const [busDown, setBusDownState] = React.useState(live.isBusDown())
  React.useEffect(() => live.onBusDownChange(setBusDownState), [])

  // lock background scroll while the mobile drawer is open (P2-14)
  React.useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [navOpen])

  return (
    <div className="flex h-full">
      {/* desktop sidebar */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-kumo-line bg-kumo-elevated lg:flex">
        <SidebarContent base={base} />
      </aside>

      {/* mobile off-canvas drawer — modal semantics + body scroll lock (P2-14) */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={onNavClose}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="navigation"
            className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-kumo-line bg-kumo-base shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent base={base} onNavigate={onNavClose} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar base={base} onMenu={onMenu} onOpenPalette={onOpenPalette} />
        <NetActivityBar />
        {busDown && (
          <div className="border-b border-kumo-warning/30 bg-kumo-warning-tint px-4 py-1.5 text-[12px] text-kumo-warning">
            Live updates unavailable — retrying…
          </div>
        )}
        <PausedAwareMain>{children}</PausedAwareMain>
      </div>
    </div>
  )
}

function SidebarContent({ base, onNavigate }: { base: string; onNavigate?: () => void }) {
  // topmost-Esc closes the drawer (P2-9) — registered when the drawer mounts
  useEscToClose(() => onNavigate?.())

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
          {NAV_GROUPS.map((group) => (
            <NavGroup
              key={group.label}
              label={group.label}
              base={base}
              items={NAV.filter((n) => group.paths.includes(n.to))}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        <div className="border-t border-kumo-line px-4 py-3 text-[11px] leading-4 text-kumo-subtle">
          reads the cluster's storage
          <br />
          <span className="text-kumo-subtle">1–9 switch · ⌘K palette · / search · esc close</span>
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
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
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
              <kbd className="hidden text-[10px] text-kumo-subtle group-hover:inline">
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
