/**
 * Client-side export helpers: download data as JSON or CSV via a Blob +
 * temporary anchor click. No server round-trip needed.
 */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(data: unknown, filename: string): void {
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename)
}

/** Quote/escape a single CSV field (quotes fields containing , " or newlines). */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function downloadCsv(rows: ReadonlyArray<Record<string, unknown>>, filename: string): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [headers, ...rows.map((row) => headers.map((h) => csvField(row[h])))]
  triggerDownload(new Blob([lines.map((line) => line.join(",")).join("\n")], { type: "text/csv" }), filename)
}
