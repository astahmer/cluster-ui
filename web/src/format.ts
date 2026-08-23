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

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
