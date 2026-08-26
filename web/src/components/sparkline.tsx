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

// kumo semantic tokens — light/dark handled by the CSS vars themselves
export const TONE_COLORS = {
  accent: "var(--color-kumo-brand)",
  ok: "var(--color-kumo-success)",
  warn: "var(--color-kumo-warning)",
  err: "var(--color-kumo-danger)",
  info: "var(--color-kumo-info)",
  muted: "var(--color-kumo-subtle)"
} as const

export type SparklineTone = keyof typeof TONE_COLORS

export interface SparklinePoint {
  t: number
  v: number
}

export interface SparklineBrushRange {
  from: number
  to: number
}

const VIEW_W = 300
const VIEW_H = 100
/** headroom so the line never clips against the frame */
const PAD_Y = 8
/** hover labels switch to day-aware formatting past a full day of samples
 * ("14:32" is ambiguous across seven days — UX audit #2) */
const DAY_MS = 24 * 60 * 60 * 1000

export function Sparkline({
  points,
  tone = "accent",
  height = 48,
  formatValue = (v: number) => String(v),
  showLastLabel = true,
  onBrush,
  brushRange,
  className
}: {
  points: ReadonlyArray<SparklinePoint>
  tone?: SparklineTone
  /** pixel height of the chart area */
  height?: number
  formatValue?: (v: number) => string
  showLastLabel?: boolean
  /** Called after a click-drag selects a time window. */
  onBrush?: (range: SparklineBrushRange) => void
  /** Controlled range rendered over the chart, in epoch milliseconds. */
  brushRange?: SparklineBrushRange | null
  className?: string
}) {
  const color = TONE_COLORS[tone]
  const values = points.map((p) => p.v)
  // P1-10: pointer-tracking crosshair — hover inspects t/v at any point
  const wrapRef = React.useRef<HTMLDivElement | null>(null)
  const dragStartRef = React.useRef<number | null>(null)
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)
  const [dragSelection, setDragSelection] = React.useState<[number, number] | null>(null)

  if (values.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-kumo-line text-[11px] text-kumo-subtle",
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

  const visibleSpanMs = points.length >= 2 ? last.t - points[0].t : 0
  const formatHoverTime = (t: number) => {
    const d = new Date(t)
    return (
      visibleSpanMs > DAY_MS ?
        d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) :
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    )
  }

  const indexAtPointer = (e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || points.length < 2) return null
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    return Math.round(frac * (points.length - 1))
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const idx = indexAtPointer(e)
    if (idx === null) return
    setHoverIdx(idx)
    const start = dragStartRef.current
    if (start !== null) setDragSelection([Math.min(start, idx), Math.max(start, idx)])
  }
  const finishBrush = (e: React.PointerEvent) => {
    const start = dragStartRef.current
    const idx = indexAtPointer(e)
    dragStartRef.current = null
    if (idx === null || start === null || !onBrush) return
    const left = Math.min(start, idx)
    const right = Math.max(start, idx)
    if (right === left) {
      setDragSelection(null)
      return
    }
    setDragSelection([left, right])
    onBrush({ from: points[left].t, to: points[right].t })
  }
  const hovered = hoverIdx !== null ? points[hoverIdx] : null
  const controlledSelection = brushRange && points.length > 1 ? [
    points.findIndex((p) => p.t >= brushRange.from),
    points.findLastIndex((p) => p.t <= brushRange.to)
  ] as [number, number] : null
  const selection = controlledSelection && controlledSelection[0] >= 0 && controlledSelection[1] >= controlledSelection[0]
    ? controlledSelection
    : dragSelection

  return (
    <div
      ref={wrapRef}
      className={cn("relative", onBrush ? "cursor-crosshair select-none" : "", className)}
      style={{ height }}
      role="img"
      aria-label={`${formatValue(last.v)}${onBrush ? "; click and drag to select a time range" : ""}`}
      tabIndex={onBrush ? 0 : undefined}
      onPointerDown={(e) => {
        if (!onBrush) return
        const idx = indexAtPointer(e)
        if (idx !== null) {
          dragStartRef.current = idx
          setDragSelection([idx, idx])
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }
      }}
      onPointerMove={onPointerMove}
      onPointerUp={finishBrush}
      onPointerCancel={() => { dragStartRef.current = null; setDragSelection(null) }}
      onPointerLeave={() => { if (dragStartRef.current === null) setHoverIdx(null) }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={formatValue(last.v)}
      >
        {selection && selection[1] > selection[0] && (
          <rect
            x={x(selection[0])}
            y={0}
            width={Math.max(1, x(selection[1]) - x(selection[0]))}
            height={VIEW_H}
            fill={color}
            fillOpacity={0.12}
            stroke={color}
            strokeOpacity={0.5}
            strokeDasharray="3 2"
          />
        )}
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
        {/* crosshair at the hovered sample (P1-10) */}
        {hovered && hoverIdx !== null && values.length > 1 && (
          <g>
            <line
              x1={x(hoverIdx)}
              y1={0}
              x2={x(hoverIdx)}
              y2={VIEW_H}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <rect
              x={x(hoverIdx) - 4}
              y={y(hovered.v) - 4}
              width={8}
              height={8}
              rx={4}
              fill={color}
              stroke="var(--color-kumo-base)"
              strokeWidth={1.5}
            />
          </g>
        )}
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
        <span className="absolute right-0 top-0 rounded bg-kumo-base/80 px-1 text-[11px] font-semibold tabular-nums text-kumo-default">
          {formatValue(last.v)}
        </span>
      )}
      {hovered && (
        <span
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-kumo-line bg-kumo-elevated px-1.5 py-0.5 text-[11px] tabular-nums text-kumo-default shadow-sm"
          style={{ left: `${values.length > 1 ? (hoverIdx! / (values.length - 1)) * 100 : 50}%` }}
        >
          {formatValue(hovered.v)}
          <span className="ml-1 text-kumo-subtle">{formatHoverTime(hovered.t)}</span>
        </span>
      )}
    </div>
  )
}
