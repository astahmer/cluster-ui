/**
 * Dependency-free inline SVG sparkline.
 *
 * Points are `{ t, v }` oldest-first; only `v` drives the shape (`t` is kept
 * for tooltips/labels). Rendered inside a stretched viewBox so the line fills
 * the container width; the last-value label is regular HTML so it never
 * distorts. Handles empty and single-point data gracefully.
 */
import * as React from "react"
import { cn } from "./ui.tsx"

export const TONE_COLORS = {
  accent: "var(--color-accent)",
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  err: "var(--color-err)",
  info: "var(--color-info)",
  muted: "var(--color-muted)"
} as const

export type SparklineTone = keyof typeof TONE_COLORS

export interface SparklinePoint {
  t: number
  v: number
}

const VIEW_W = 300
const VIEW_H = 100
/** headroom so the line never clips against the frame */
const PAD_Y = 8

export function Sparkline({
  points,
  tone = "accent",
  height = 48,
  formatValue = (v: number) => String(v),
  showLastLabel = true,
  className
}: {
  points: ReadonlyArray<SparklinePoint>
  tone?: SparklineTone
  /** pixel height of the chart area */
  height?: number
  formatValue?: (v: number) => string
  showLastLabel?: boolean
  className?: string
}) {
  const color = TONE_COLORS[tone]
  const values = points.map((p) => p.v)

  if (values.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted",
          className
        )}
        style={{ height }}
      >
        no samples yet
      </div>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  // flat series would sit exactly on an edge without a synthetic range
  const range = max - min > 0 ? max - min : max > 0 ? max : 1

  const x = (i: number) =>
    values.length === 1 ? VIEW_W / 2 : (i / (values.length - 1)) * VIEW_W
  const y = (v: number) => VIEW_H - PAD_Y - ((v - min) / range) * (VIEW_H - PAD_Y * 2)

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.v).toFixed(2)}`)
    .join(" ")
  const areaPath =
    values.length === 1 ?
      "" :
      `${linePath} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`

  const last = points[points.length - 1]

  return (
    <div className={cn("relative", className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={formatValue(last.v)}
      >
        {areaPath && (
          <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
        )}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* last-point marker (circle radius compensates non-uniform scaling visually) */}
        <rect
          x={(values.length === 1 ? VIEW_W / 2 : VIEW_W) - 3}
          y={y(last.v) - 3}
          width={6}
          height={6}
          rx={3}
          fill={color}
        />
      </svg>
      {showLastLabel && (
        <span className="absolute right-0 top-0 rounded bg-surface/80 px-1 text-[11px] font-semibold tabular-nums text-text">
          {formatValue(last.v)}
        </span>
      )}
    </div>
  )
}
