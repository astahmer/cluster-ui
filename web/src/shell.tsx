import * as React from "react"
import { cn } from "./components/ui.tsx"

/* ------------------------------ hash routing ------------------------------ */

export function useHashRoute(): string {
  const [hash, setHash] = React.useState(() => window.location.hash.slice(1) || "/overview")
  React.useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || "/overview")
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return hash
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

/* ------------------------------ auto refresh ------------------------------ */

const REFRESH_MS = 4000

export function usePolling(fetcher: () => Promise<unknown>, deps: unknown[] = []) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        await fetcher()
        setError(null)
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { loading, error, refresh: () => setTick((t) => t + 1) }
}

/* --------------------------------- layout --------------------------------- */

const NAV = [
  { to: "/overview", label: "Overview", icon: "◧" },
  { to: "/runners", label: "Runners", icon: "▣" },
  { to: "/shards", label: "Shards", icon: "▦" },
  { to: "/entities", label: "Entities", icon: "◫" },
  { to: "/workflows", label: "Workflows", icon: "⌘" },
  { to: "/messages", label: "Messages", icon: "≡" }
]

export function Shell({ route, children }: { route: string; children: React.ReactNode }) {
  const base = "/" + (route.split("/")[1] ?? "overview")
  return (
    <div className="flex h-full">
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
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                base === item.to
                  ? "bg-accent/12 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-text"
              )}
            >
              <span className="w-4 text-center opacity-80">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3 text-[11px] leading-4 text-muted">
          reads the cluster's SQL storage
          <br />
          refresh every 4s
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-5">{children}</main>
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
