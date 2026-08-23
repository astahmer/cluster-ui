export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—"
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

export function relTime(ms: number | null | undefined): string {
  if (!ms) return "—"
  const delta = Date.now() - ms
  if (delta < 0) return `in ${fmtDur(-delta)}`
  return `${fmtDur(delta)} ago`
}

/** "in 4m" style countdown toward a future epoch-millis timestamp. */
export function fmtCountdown(msUntil: number | null | undefined): string {
  if (msUntil === null || msUntil === undefined) return "—"
  const delta = msUntil - Date.now()
  if (delta <= 0) return "now"
  return `in ${fmtDur(delta)}`
}

/** compact duration, e.g. "42s", "12m", "3h", "2d" */
export function fmtDuration(ms: number): string {
  return fmtDur(ms)
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
