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
  selectedKey,
  onSelect
}: {
  spans: TimelineSpan[]
  /** minimum height of the tracks area (px); rows size naturally */
  height?: number
  selectedKey?: string | null
  onSelect?: (span: TimelineSpan) => void
}) {
  const timed = spans.filter((s) => Number.isFinite(s.startMs))
  if (timed.length === 0) return null

  // stable order: groups keep their own blocks, within everything sorts by start
  const sorted = [...timed].sort((a, b) => {
    if (a.group !== b.group) {
      const ga = a.group ?? ""
      const gb = b.group ?? ""
      const firstOf = (g: string) => Math.min(...timed.filter((s) => (s.group ?? "") === g).map((s) => s.startMs))
      return firstOf(ga) - firstOf(gb)
    }
    return a.startMs - b.startMs
  })

  const t0 = Math.min(...timed.map((s) => s.startMs))
  const t1 = Math.max(...timed.map((s) => Math.max(s.endMs, s.startMs)))
  const range = Math.max(t1 - t0, 1)
  const pct = (t: number) => ((t - t0) / range) * 100

  const ticks = displayTicks(t0, t1)

  let lastGroup: string | undefined
  const seenKey = new Set<string>()

  return (
    <div className="overflow-x-auto rounded-md border border-kumo-line">
      <div className="min-w-[680px]">
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
        <div className="relative px-3 py-2" style={height ? { minHeight: height } : undefined}>
          {sorted.map((s) => {
            const showGroupHeader = s.group !== undefined && s.group !== lastGroup
            lastGroup = s.group
            const duplicate = seenKey.has(s.key)
            seenKey.add(s.key)
            if (duplicate) return null

            const zeroDur = s.endMs <= s.startMs
            const left = pct(s.startMs)
            const width = Math.max(pct(Math.max(s.endMs, s.startMs + 1)) - left, 0.75)
            const tip = `${typeof s.label === "string" || typeof s.label === "number" ? s.label : "span"} · ${fmtTime(s.startMs)}${
              zeroDur ? "" : ` → ${axisLabel(s.endMs - s.startMs).replace(/^\+/, "")}`
            }`

            const selected = selectedKey === s.key
            const rowLabel = `${typeof s.label === "string" || typeof s.label === "number" ? s.label : "span"} · ${axisLabel(s.endMs - s.startMs).replace(/^\+/, "")} · ${s.tone === "danger" ? "failed" : s.tone === "success" ? "completed" : "active"}`

            return (
              <React.Fragment key={s.key}>
                {showGroupHeader && (
                  <div className="mt-2 mb-1 border-b border-kumo-line pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle first:mt-0">
                    {s.group}
                  </div>
                )}
                <button
                  type="button"
                  className={cn(
                    "group flex w-full items-center gap-3 rounded py-[3px] text-left transition-colors hover:bg-kumo-tint/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
                    selected && "bg-kumo-tint/80"
                  )}
                  title={tip}
                  aria-label={rowLabel}
                  aria-pressed={selected}
                  onClick={() => onSelect?.(s)}
                >
                  <span className="flex w-[276px] shrink-0 items-center gap-1.5 truncate pl-1 text-left text-[11px] text-kumo-subtle" style={{ paddingLeft: `${Math.max(4, (s.depth ?? 0) * 12 + 4)}px` }}>
                    <span className="truncate">{s.label}</span>
                    {s.badge}
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
                          TONE_BAR[s.tone ?? "default"]
                        )}
                        style={{ left: `${left}%` }}
                      />
                    ) : (
                      <span
                        className={cn(
                          "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ring-2 ring-transparent",
                          selected && "ring-kumo-default",
                          TONE_BAR[s.tone ?? "default"]
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    )}
                  </div>
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
