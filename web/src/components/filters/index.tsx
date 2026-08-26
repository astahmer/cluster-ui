import * as React from "react"
import { CaretDown, Funnel, X } from "@phosphor-icons/react"
import { Checkbox } from "../../kumo"
import { cn } from "../ui.tsx"

/**
 * reui.io-style faceted filters (docs/ROADMAP.md): a toolbar row of facet
 * trigger popovers ("column: value ✕" pills) plus removable chips for active
 * values. Client-side only — pages pass their loaded rows and per-facet
 * predicates; `useFacets` returns the filtered rows.
 *
 * Adapted by hand from reui's Filters UX (their registry ships via shadcn CLI,
 * not raw source) onto vendored kumo tokens.
 */

export interface FacetOption {
  value: string
  label?: string
}

export interface FacetDef<T> {
  key: string
  label: string
  options: (rows: ReadonlyArray<T>) => ReadonlyArray<FacetOption>
  predicate: (row: T, values: ReadonlyArray<string>) => boolean
}

export interface FacetsApi<T> {
  /** rows surviving every active facet predicate, in original order */
  filtered: T[]
  active: Record<string, string[]>
  toggle: (key: string, value: string) => void
  clear: (key: string) => void
  clearAll: () => void
  hasActive: boolean
}

function readFacetState<T>(defs: ReadonlyArray<FacetDef<T>>): Record<string, string[]> {
  if (typeof window === "undefined") return {}
  const raw = window.location.hash.slice(1)
  const query = raw.indexOf("?") === -1 ? "" : raw.slice(raw.indexOf("?") + 1)
  const params = new URLSearchParams(query)
  return Object.fromEntries(defs.flatMap((def) => {
    const values = params.getAll(`facet_${def.key}`)
    return values.length > 0 ? [[def.key, values]] : []
  }))
}

function writeFacetState<T>(defs: ReadonlyArray<FacetDef<T>>, active: Record<string, string[]>) {
  if (typeof window === "undefined") return
  const raw = window.location.hash.slice(1) || "/overview"
  const q = raw.indexOf("?")
  const path = q === -1 ? raw : raw.slice(0, q)
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1))
  for (const def of defs) {
    params.delete(`facet_${def.key}`)
    for (const value of active[def.key] ?? []) params.append(`facet_${def.key}`, value)
  }
  const query = params.toString()
  window.history.replaceState(null, "", `#${path}${query ? `?${query}` : ""}`)
}

export function useFacets<T>(rows: readonly T[], defs: ReadonlyArray<FacetDef<T>>): FacetsApi<T> {
  const [active, setActive] = React.useState<Record<string, string[]>>(() => readFacetState(defs))

  const filtered = React.useMemo(() => {
    // tolerate non-array data while a page's first fetch resolves or a backend degrades
    const list: readonly T[] = Array.isArray(rows) ? rows : []
    const activeDefs = defs.filter((d) => (active[d.key]?.length ?? 0) > 0)
    if (activeDefs.length === 0) return [...list]
    return list.filter((row) => activeDefs.every((def) => def.predicate(row, active[def.key])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, defs, active])

  const toggle = React.useCallback((key: string, value: string) => {
    setActive((prev) => {
      const current = prev[key] ?? []
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      const nextState = { ...prev, [key]: next }
      writeFacetState(defs, nextState)
      return nextState
    })
  }, [defs])

  const clear = React.useCallback((key: string) => setActive((prev) => {
    const next = { ...prev, [key]: [] }
    writeFacetState(defs, next)
    return next
  }), [defs])

  const clearAll = React.useCallback(() => {
    setActive((prev) => {
      const next = Object.fromEntries(Object.keys(prev).map((key) => [key, []]))
      writeFacetState(defs, next)
      return next
    })
  }, [defs])

  return { filtered, active, toggle, clear, clearAll, hasActive: Object.values(active).some((v) => v.length > 0) }
}

/** One facet trigger pill + its popover of searchable checkboxes. */
function FacetTrigger<T>({
  def,
  rows,
  selected,
  onToggle,
  onClear
}: {
  def: FacetDef<T>
  rows: ReadonlyArray<T>
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  // close on outside click / Esc
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  const allOptions = React.useMemo(() => def.options(rows), [def, rows])
  const visible =
    query.trim() === "" ?
      allOptions :
      allOptions.filter((o) => (o.label ?? o.value).toLowerCase().includes(query.trim().toLowerCase()))
  const isActive = selected.length > 0

  return (
    <div className="relative" ref={rootRef}>
      {isActive ? (
        // P1-7: label + clear must be sibling buttons — nested interactive
        // controls inside one <button> are invalid DOM/AX
        <span className="flex items-stretch overflow-hidden rounded-md border border-kumo-brand/40 bg-kumo-tint">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-kumo-default transition-colors hover:bg-kumo-tint"
          >
            {def.label}
            <span className="rounded bg-kumo-brand/20 px-1 tabular-nums">{selected.length}</span>
            <CaretDown className="h-3 w-3 opacity-60" />
          </button>
          <span className="w-px bg-kumo-brand/30" aria-hidden="true" />
          <button
            type="button"
            aria-label={`clear ${def.label} filter`}
            onClick={onClear}
            className="cursor-pointer px-1.5 text-kumo-subtle transition-colors hover:bg-kumo-brand/20 hover:text-kumo-default"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-kumo-line bg-kumo-base px-2.5 py-1 text-[12px] font-medium text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default"
        >
          <Funnel className="h-3 w-3 opacity-70" />
          {def.label}
          <CaretDown className="h-3 w-3 opacity-60" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-kumo-line bg-kumo-base p-2 shadow-lg">
          {allOptions.length > 8 && (
            <input
              autoFocus
              aria-label={`search ${def.label.toLowerCase()} filter options`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search…"
              className="mb-1.5 w-full rounded border border-kumo-line bg-kumo-canvas px-2 py-1 text-[12px] outline-none placeholder:text-kumo-subtle focus:border-kumo-brand"
            />
          )}
          <div className="max-h-56 overflow-y-auto">
            {visible.length === 0 && (
              <div className="px-1 py-2 text-[12px] text-kumo-subtle">no options</div>
            )}
            {visible.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-kumo-tint"
                >
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(option.value)}
                  />
                  <span className="text-[12px] text-kumo-default">{option.label ?? option.value}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Toolbar row of facet triggers + removable chips for every active value.
 * Renders nothing when no facets are configured.
 */
export function FilterBar<T>({
  defs,
  rows,
  facets
}: {
  defs: ReadonlyArray<FacetDef<T>>
  rows: ReadonlyArray<T>
  facets: FacetsApi<T>
}) {
  if (defs.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {defs.map((def) => (
        <FacetTrigger
          key={def.key}
          def={def}
          rows={rows}
          selected={facets.active[def.key] ?? []}
          onToggle={(value) => facets.toggle(def.key, value)}
          onClear={() => facets.clear(def.key)}
        />
      ))}
      {facets.hasActive && (
        <>
          {(Object.entries(facets.active) as Array<[string, string[]]>).flatMap(([key, values]) =>
            values.map((value) => {
              const def = defs.find((d) => d.key === key)
              if (!def) return null
              return (
                <span
                  key={`${key}:${value}`}
                  className="flex items-center gap-1 rounded-full border border-kumo-line bg-kumo-tint px-2 py-0.5 text-[11px] text-kumo-default"
                >
                  {def.label}: {value}
                  <button
                    type="button"
                    aria-label={`remove filter ${key} ${value}`}
                    className="cursor-pointer rounded-full p-0.5 hover:bg-kumo-brand/20"
                    onClick={() => facets.toggle(key, value)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )
            })
          )}
          <button
            type="button"
            onClick={facets.clearAll}
            className="cursor-pointer text-[11px] text-kumo-subtle underline underline-offset-2 hover:text-kumo-default"
          >
            clear all
          </button>
        </>
      )}
    </div>
  )
}

/** Convenience for boolean-presence facets: value is "yes"/"no". */
export function presenceFacet<T>(
  key: string,
  label: string,
  test: (row: T) => boolean,
  yesLabel?: string
): FacetDef<T> {
  return {
    key,
    label,
    options: () => [
      { value: "yes", label: yesLabel ?? label },
      { value: "no", label: `not ${label.toLowerCase()}` }
    ],
    predicate: (row, values) =>
      values.includes(test(row) ? "yes" : "no")
  }
}
