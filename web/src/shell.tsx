import * as React from "react"
import { api } from "./api.ts"
import { usePaused, setPaused as setGlobalPaused } from "./live.ts"
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

/** @deprecated use `useRoute` — returns the raw hash path */
export function useHashRoute(): string {
  return useRoute().path
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
import * as live from "./live.ts"

/**
 * @deprecated kept as a bridge until all pages migrate — identical ergonomics,
 * now SSE-driven via `useLive` instead of blind 4s interval polling.
 */
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

const THEME_KEY = "cluster_ui_theme"

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {}
}

function initialTheme(): string {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
  } catch {}
  return stored ?? "dark"
}

/* --------------------------------- layout --------------------------------- */

const NAV = [
  { to: "/overview", label: "Overview", icon: "◧" },
  { to: "/runners", label: "Runners", icon: "▣" },
  { to: "/shards", label: "Shards", icon: "▦" },
  { to: "/entities", label: "Entities", icon: "◫" },
  { to: "/crons", label: "Crons", icon: "◷" },
  { to: "/workflows", label: "Workflows", icon: "⌘" },
  { to: "/messages", label: "Messages", icon: "≡" }
]

function TopBar({ base }: { base: string }) {
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
      (document.documentElement.dataset.theme ?? initialTheme()) === "dark" ? "light" : "dark"
    applyTheme(next)
  }

  return (
    <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-border bg-surface px-4">
      {clusters.length > 1 && (
        <select
          aria-label="cluster"
          className="h-7 rounded-md border border-border bg-bg px-2 text-[12px] text-text focus:border-accent focus:outline-none cursor-pointer"
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
        onClick={() => setGlobalPaused(!paused)}
        title={paused ? "resume auto-refresh" : "pause auto-refresh"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer transition-colors",
          paused
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-ok/40 bg-ok/10 text-ok"
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", paused ? "bg-warn" : "bg-ok animate-pulse")} />
        {paused ? "paused" : "live"}
      </button>

      <button
        type="button"
        onClick={pickTheme}
        title="toggle light/dark"
        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
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
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center gap-2 px-4 py-4">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white">
              c
            </span>
            <div>
              <div className="text-sm font-semibold leading-4">cluster-ui</div>
              <div className="text-[11px] text-muted">effect v4 dashboard</div>
            </div>
          </div>
          <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2">
            {NAV.map((item, i) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  base === item.to
                    ? "bg-accent/12 text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-text"
                )}
              >
                <span className="w-4 text-center opacity-80">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <kbd className="hidden text-[10px] text-muted/60 group-hover:inline">{i + 1}</kbd>
              </Link>
            ))}
          </nav>
          <div className="border-t border-border px-4 py-3 text-[11px] leading-4 text-muted">
            reads the cluster's SQL storage
            <br />
            <span className="text-muted/70">1–{NAV.length} switch · / search · esc close</span>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar base={base} />
          <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
        </div>
      </div>
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
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[13px] text-err">
      {error}
    </div>
  )
}
