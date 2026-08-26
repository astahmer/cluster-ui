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
  keywords?: string
  /** trailing muted text */
  hint?: string
  run: () => void
}

export function CommandPalette({
  open,
  onClose,
  staticItems,
  dynamicItems = (): PaletteItem[] => []
}: {
  open: boolean
  onClose: () => void
  /** fixed commands (pages etc.) */
  staticItems: PaletteItem[]
  /** context-dependent commands recomputed from the typed query (deep links) */
  dynamicItems?: (query: string) => PaletteItem[]
}) {
  const [query, setQuery] = React.useState("")
  const [index, setIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const all = React.useMemo(
    () => [...staticItems, ...(query.trim() ? dynamicItems(query.trim()) : [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staticItems, dynamicItems, query]
  )
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 12)
    return all
      .filter((item) => {
        const hay = `${item.keywords ?? ""} ${typeof item.label === "string" ? item.label : ""}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 12)
  }, [all, query])

  React.useEffect(() => {
    setIndex(0)
  }, [query, open])

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setIndex(0)
      // focus after the dialog mounts
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

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
          <MagnifyingGlass className="h-4 w-4 shrink-0 text-kumo-inactive" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to page or paste a message id…"
            aria-label="command palette"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={`palette-option-${index}`}
            className="w-full bg-transparent text-sm outline-none placeholder:text-kumo-inactive"
          />
          <kbd className="rounded border border-kumo-line px-1 text-[10px] text-kumo-inactive">esc</kbd>
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
                {item.keywords && (
                  <span className="truncate text-[11px] text-kumo-inactive">{item.keywords}</span>
                )}
              </span>
              {item.hint && <kbd className="shrink-0 text-[10px] text-kumo-inactive">{item.hint}</kbd>}
            </button>
          ))}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
