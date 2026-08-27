import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { Dialog, Input, cn } from "../kumo"

/**
 * ⌘K command palette. Generic item list + built-in snowflake-id deep link:
 * typing an all-digit id surfaces "Open message <id>".
 */

export interface PaletteItem {
  key: string
  label: React.ReactNode
  /**
   * search-only terms — never rendered (P1-11); use `subtitle` for visible
   * secondary text
   */
  keywords?: string
  /** visible secondary line */
  subtitle?: string
  /** trailing muted text */
  hint?: string
  run: () => void
}

/** Debounced, abortable domain-object source for the palette (P1-11). */
export interface AsyncPaletteProvider {
  key: string
  fetch: (query: string, signal: AbortSignal) => Promise<PaletteItem[]>
}

/* short-lived provider result cache so backspacing doesn't refetch spam */
const providerCache = new Map<string, { at: number; items: PaletteItem[] }>()
const PROVIDER_CACHE_TTL_MS = 30_000
function cacheGet(providerKey: string, query: string): PaletteItem[] | null {
  const hit = providerCache.get(`${providerKey}:${query}`)
  if (!hit) return null
  if (Date.now() - hit.at > PROVIDER_CACHE_TTL_MS) {
    providerCache.delete(`${providerKey}:${query}`)
    return null
  }
  return hit.items
}

/**
 * Fuzzy subsequence scoring (P1-11): all query chars must appear in order in
 * the haystack; score rewards contiguous runs and word-start hits. Returns -1
 * when the query doesn't match.
 */
function fuzzyScore(haystack: string, needle: string): number {
  const hay = haystack.toLowerCase()
  const q = needle.toLowerCase()
  let score = 0
  let hayIdx = 0
  let streak = 0
  for (let i = 0; i < q.length; i++) {
    const found = hay.indexOf(q[i], hayIdx)
    if (found === -1) return -1
    // contiguous with previous match → bonus
    if (found === hayIdx && i > 0) streak += 1
    else streak = 0
    score += 10 + streak * 4
    // word-start hit → bonus
    if (found === 0 || /[-/ _]/.test(hay[found - 1] ?? "")) score += 6
    hayIdx = found + 1
  }
  return score
}

export function CommandPalette({
  open,
  onClose,
  staticItems,
  dynamicItems = (): PaletteItem[] => [],
  asyncProviders = []
}: {
  open: boolean
  onClose: () => void
  /** fixed commands (pages etc.) */
  staticItems: PaletteItem[]
  /** context-dependent commands recomputed from the typed query (deep links) */
  dynamicItems?: (query: string) => PaletteItem[]
  /** debounced domain-object providers (entities, workflows, …) run while open (P1-11) */
  asyncProviders?: AsyncPaletteProvider[]
}) {
  const [query, setQuery] = React.useState("")
  const [index, setIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [asyncItems, setAsyncItems] = React.useState<PaletteItem[]>([])

  const all = React.useMemo(
    () => [...staticItems, ...(query.trim() ? dynamicItems(query.trim()) : []), ...asyncItems],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staticItems, dynamicItems, asyncItems, query]
  )
  const filtered = React.useMemo(() => {
    const q = query.trim()
    if (!q) return all.slice(0, 12)
    return all
      .map((item) => {
        const labelStr = typeof item.label === "string" ? item.label : item.key
        const kw = fuzzyScore(`${item.keywords ?? ""} ${labelStr}`, q)
        const lbl = fuzzyScore(labelStr, q)
        // best of label-match vs keyword-match, label matches rank higher
        const score = Math.max(lbl === -1 ? -1 : lbl + 50, kw)
        return { item, score }
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.item)
  }, [all, query])

  React.useEffect(() => {
    setIndex(0)
  }, [query, open])

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setIndex(0)
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(focusTimer)
    } else {
      setAsyncItems([])
    }
  }, [open])

  // P1-11: debounced + abortable async providers; only fetches while open.
  // The api layer has no signal support, so aborting is enforced by dropping
  // results when the effect's controller is already aborted.
  React.useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2 || asyncProviders.length === 0) {
      setAsyncItems([])
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      Promise.all(
        asyncProviders.map(async (provider) => {
          const cached = cacheGet(provider.key, q)
          if (cached) return cached
          try {
            const items = await provider.fetch(q, controller.signal)
            const capped = items.slice(0, 5)
            providerCache.set(`${provider.key}:${q}`, { at: Date.now(), items: capped })
            return capped
          } catch {
            return []
          }
        })
      )
        .then((groups) => {
          if (!cancelled && !controller.signal.aborted) setAsyncItems(groups.flat())
        })
        .catch(() => {})
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open, asyncProviders])

  const run = (item: PaletteItem) => {
    onClose()
    item.run()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = filtered[index]
      if (item) run(item)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-kumo-line px-4 py-3">
          <MagnifyingGlass className="h-4 w-4 shrink-0 text-kumo-subtle" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to page or paste a message id…"
            aria-label="command palette"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={filtered[index] ? `palette-option-${index}` : undefined}
            className="w-full bg-transparent text-sm outline-none placeholder:text-kumo-subtle"
          />
          <kbd className="rounded border border-kumo-line px-1 text-[10px] text-kumo-subtle">esc</kbd>
        </div>
        <div id="command-palette-listbox" className="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label="commands">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-kumo-subtle">no matches</div>
          )}
          {filtered.map((item, i) => (
            <button
              type="button"
              key={item.key}
              id={`palette-option-${i}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(item)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[13px]",
                i === index ? "bg-kumo-tint text-kumo-default" : "text-kumo-subtle"
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                {item.subtitle && (
                  <span className="truncate text-[11px] text-kumo-subtle">{item.subtitle}</span>
                )}
              </span>
              {item.hint && <kbd className="shrink-0 text-[10px] text-kumo-subtle">{item.hint}</kbd>}
            </button>
          ))}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
