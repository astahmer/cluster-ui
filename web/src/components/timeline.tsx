import * as React from "react"
import { cn } from "../kumo"
import { fmtTime } from "../format.ts"

/**
 * Span-waterfall / Gantt timeline (shared time axis, labeled duration bars),
 * modeled on OTel trace waterfalls and phase-grouped Gantt charts.
 *
 * Pure divs + percentages inside a horizontally scrollable track — no external
 * deps, kumo semantic tokens only.
 */

export interface TimelineSpan {
  key: string
  label: React.ReactNode
  /** spans sharing a group get a full-width group header row above them */
  group?: string
  startMs: number
  /** may equal startMs → rendered as a point marker instead of a bar */
  endMs: number
  tone?: "default" | "danger" | "success" | "warning"
  badge?: React.ReactNode
  detail?: string
  searchText?: string
  durationSource?: "recorded" | "inferred"
  parentKey?: string
  depth?: number
  critical?: boolean
  concurrent?: boolean
}

const TONE_BAR: Record<NonNullable<TimelineSpan["tone"]>, string> = {
  default: "bg-kumo-brand/70",
  danger: "bg-kumo-danger",
  success: "bg-kumo-success",
  warning: "bg-kumo-warning"
}

/** nice round step for ~4 ticks across a range (ms) */
function tickStep(rangeMs: number): number {
  const raw = rangeMs / 4
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const norm = raw / pow
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return mult * pow
}

function niceTicks(t0: number, t1: number): number[] {
  const range = Math.max(t1 - t0, 1)
  const step = tickStep(range)
  const ticks: number[] = []
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t)
  return ticks
}

/** Display ticks (UX audit #2): always include both edges, thin interior to at
 * most 3 nice steps → ~5 labels total, so a narrow modal never renders an
 * unreadable run-on of colliding tick labels. */
function displayTicks(t0: number, t1: number): number[] {
  const interior = niceTicks(t0, t1).filter((t) => t > t0 && t < t1)
  let picked = interior
  if (interior.length > 3) {
    // evenly resample the interior down to 3 (indices guaranteed distinct)
    picked = [0, 1, 2].map((i) => interior[Math.round((i * (interior.length - 1)) / 2)])
  }
  return [...new Set([t0, ...picked, t1])]
}

/** sub-second-precise label for waterfall axis ticks (fmtDuration rounds to whole seconds) */
function axisLabel(ms: number): string {
  if (ms <= 0) return "0"
  if (ms < 1000) return `+${Math.round(ms)}ms`
  return `+${(ms / 1000).toFixed(1)}s`
}

export function SpanWaterfall({
  spans,
  height,
  zoom = 1,
  selectedKey,
  onSelect,
  collapsedGroups,
  onToggleGroup
}: {
  spans: TimelineSpan[]
  /** viewport height of the tracks area (px); rows virtualize inside it */
  height?: number
  /** horizontal time-axis scale; values above 1 make short spans easier to inspect */
  zoom?: number
  selectedKey?: string | null
  onSelect?: (span: TimelineSpan) => void
  collapsedGroups?: ReadonlySet<string>
  onToggleGroup?: (group: string) => void
}) {
  const [scrollTop, setScrollTop] = React.useState(0)
  const timed = spans.filter((s) => Number.isFinite(s.startMs))
  if (timed.length === 0) return null

  // stable order: groups keep their own blocks, within everything sorts by start
  const firstByGroup = new Map<string, number>()
  for (const span of timed) {
    const group = span.group ?? ""
    const first = firstByGroup.get(group)
    if (first === undefined || span.startMs < first) firstByGroup.set(group, span.startMs)
  }
  const sorted = [...timed].sort((a, b) => {
    if (a.group !== b.group) {
      const ga = a.group ?? ""
      const gb = b.group ?? ""
      return (firstByGroup.get(ga) ?? 0) - (firstByGroup.get(gb) ?? 0)
    }
    return a.startMs - b.startMs
  })

  const t0 = Math.min(...timed.map((s) => s.startMs))
  const t1 = Math.max(...timed.map((s) => Math.max(s.endMs, s.startMs)))
  const range = Math.max(t1 - t0, 1)
  const pct = (t: number) => ((t - t0) / range) * 100

  const ticks = displayTicks(t0, t1)
  const timelineItems: Array<
    { kind: "header"; label: string; count: number; collapsed: boolean } | { kind: "span"; span: TimelineSpan }
  > = []
  let lastGroup: string | undefined
  const seenKey = new Set<string>()
  for (const span of sorted) {
    if (seenKey.has(span.key)) continue
    seenKey.add(span.key)
    if (span.group !== undefined && span.group !== lastGroup) {
      const groupCount = sorted.filter((candidate) => candidate.group === span.group).length
      const collapsed = collapsedGroups?.has(span.group) === true
      timelineItems.push({ kind: "header", label: span.group, count: groupCount, collapsed })
      lastGroup = span.group
    }
    if (span.group !== undefined && collapsedGroups?.has(span.group)) continue
    timelineItems.push({ kind: "span", span })
  }
  const rowHeight = 30
  const viewportHeight = height ?? Math.min(560, Math.max(180, timelineItems.length * rowHeight + 16))
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 6)
  const endIndex = Math.min(timelineItems.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 6)

  return (
    <div className="overflow-x-auto rounded-md border border-kumo-line">
      <div className="min-w-0" style={{ minWidth: String(680 * Math.max(1, zoom)) + "px" }}>
        {/* shared time axis */}
        <div className="relative border-b border-kumo-line bg-kumo-recessed px-3 py-1.5">
          <div className="relative ml-[288px] h-4">
            {ticks.map((t) => {
              const isFirst = t === t0
              const isLast = t === t1
              return (
                <span
                  key={t}
                  className={cn(
                    "absolute top-0 text-[10px] tabular-nums text-kumo-subtle",
                    // edge labels are pinned inside the container instead of
                    // centering on the tick, so neither half ever clips
                    isFirst ? "translate-x-0" : isLast ? "-translate-x-full" : "-translate-x-1/2"
                  )}
                  style={{ left: `${pct(t)}%` }}
                >
                  {isFirst ? "0" : axisLabel(t - t0)}
                </span>
              )
            })}
          </div>
        </div>

        {/* rows */}
        <div
          data-testid="timeline-viewport"
          className="relative overflow-y-auto px-3 py-2"
          style={{ height: viewportHeight }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="relative" style={{ height: timelineItems.length * rowHeight }}>
          {timelineItems.slice(startIndex, endIndex).map((item, offset) => {
            const index = startIndex + offset
            if (item.kind === "header") {
              return (
                <button
                  key={"group-" + item.label + "-" + index}
                  type="button"
                  className="absolute inset-x-0 border-b border-kumo-line pb-0.5 text-left text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
                  style={{ top: index * rowHeight + 8, height: rowHeight }}
                  aria-expanded={!item.collapsed}
                  aria-label={`${item.collapsed ? "expand" : "collapse"} ${item.label} group`}
                  onClick={() => onToggleGroup?.(item.label)}
                >
                  <span aria-hidden="true" className="mr-1 inline-block w-3">{item.collapsed ? "▸" : "▾"}</span>
                  {item.label} <span className="font-normal normal-case tracking-normal">({item.count})</span>
                </button>
              )
            }
            const s = item.span
            const zeroDur = s.endMs <= s.startMs
            const left = pct(s.startMs)
            const width = Math.max(pct(Math.max(s.endMs, s.startMs + 1)) - left, 0.75)
            const tip = `${typeof s.label === "string" || typeof s.label === "number" ? s.label : "span"} · ${fmtTime(s.startMs)}${
              zeroDur ? "" : ` → ${axisLabel(s.endMs - s.startMs).replace(/^\+/, "")}`
            }`

            const selected = selectedKey === s.key
            const rowLabel = `${s.detail ?? "span"} · ${axisLabel(s.endMs - s.startMs).replace(/^\+/, "")} · ${s.tone === "danger" ? "failed" : s.tone === "success" ? "completed" : "active"}${s.critical ? " · critical path" : ""}${s.concurrent ? " · overlaps another span" : ""}`

            return (
              <div key={s.key} className="absolute inset-x-0" style={{ top: index * rowHeight, height: rowHeight }}>
                <button
                  type="button"
                  className={cn(
                    "group flex w-full items-center gap-3 rounded py-[3px] text-left transition-colors hover:bg-kumo-tint/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
                    selected && "bg-kumo-tint/80"
                  )}
                  title={tip}
                  aria-label={rowLabel}
                  aria-pressed={selected}
                  data-duration-source={s.durationSource ?? "inferred"}
                  onClick={() => onSelect?.(s)}
                >
                  <span className={cn("sticky left-0 z-[1] flex w-[276px] shrink-0 items-center gap-1.5 truncate bg-kumo-base py-0.5 pl-1 text-left text-[11px] text-kumo-subtle group-hover:bg-kumo-tint/60", selected && "bg-kumo-tint/80")} style={{ paddingLeft: `${Math.max(4, (s.depth ?? 0) * 12 + 4)}px` }}>
                    {(s.depth ?? 0) > 0 && <span aria-hidden="true" className="text-kumo-inactive">↳</span>}
                    <span className="truncate">{s.label}</span>
                    {s.badge}
                    {s.critical && <span title="critical path" className="shrink-0 text-[9px] text-kumo-link">critical</span>}
                    {s.concurrent && <span title="overlaps another span" className="shrink-0 text-[10px] text-kumo-inactive">∥</span>}
                  </span>
                  <div className="relative h-4 flex-1">
                    {/* vertical gridlines */}
                    {ticks.map((t) => (
                      <span
                        key={t}
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-kumo-line/50"
                        style={{ left: `${pct(t)}%` }}
                      />
                    ))}
                    {zeroDur ? (
                      <span
                        className={cn(
                          "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-transparent",
                          selected && "ring-kumo-default",
                          s.critical && "ring-kumo-link",
                          TONE_BAR[s.tone ?? "default"]
                        )}
                        style={{ left: `${left}%` }}
                      />
                    ) : (
                      <span
                        className={cn(
                          "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ring-2 ring-transparent",
                          selected && "ring-kumo-default",
                          s.critical && "ring-kumo-link",
                          TONE_BAR[s.tone ?? "default"]
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    )}
                  </div>
                </button>
              </div>
            )
          })}
          </div>
        </div>
      </div>
    </div>
  )
}
