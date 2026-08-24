import * as React from "react"
import { cn } from "../kumo"
import { fmtDuration, fmtTime } from "../format.ts"

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
}

const TONE_BAR: Record<NonNullable<TimelineSpan["tone"]>, string> = {
  default: "bg-kumo-brand/70",
  danger: "bg-kumo-danger",
  success: "bg-kumo-success",
  warning: "bg-kumo-warning"
}

/** nice round step for ~5 ticks across a range (ms) */
function tickStep(rangeMs: number): number {
  const raw = rangeMs / 5
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

export function SpanWaterfall({
  spans,
  height
}: {
  spans: TimelineSpan[]
  /** minimum height of the tracks area (px); rows size naturally */
  height?: number
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

  const ticks = niceTicks(t0, t1)

  let lastGroup: string | undefined
  let seenKey = new Set<string>()

  return (
    <div className="overflow-x-auto rounded-md border border-kumo-line">
      <div className="min-w-[640px]">
        {/* shared time axis */}
        <div className="relative border-b border-kumo-line bg-kumo-recessed px-3 py-1.5">
          <div className="relative ml-[220px] h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-kumo-inactive"
                style={{ left: `${pct(t)}%` }}
              >
                {t - t0 === 0 ? "0" : `+${fmtDuration(t - t0)}`}
              </span>
            ))}
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
              zeroDur ? "" : ` → ${fmtDuration(s.endMs - s.startMs)}`
            }`

            return (
              <React.Fragment key={s.key}>
                {showGroupHeader && (
                  <div className="mt-2 mb-1 border-b border-kumo-line pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-kumo-inactive first:mt-0">
                    {s.group}
                  </div>
                )}
                <div className="flex items-center gap-3 py-[3px]" title={tip}>
                  <div className="flex w-[196px] shrink-0 items-center gap-1.5 truncate text-right text-[11px] text-kumo-subtle">
                    <span className="truncate">{s.label}</span>
                    {s.badge}
                  </div>
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
                          "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45",
                          TONE_BAR[s.tone ?? "default"]
                        )}
                        style={{ left: `${left}%` }}
                      />
                    ) : (
                      <span
                        className={cn("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm", TONE_BAR[s.tone ?? "default"])}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    )}
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
