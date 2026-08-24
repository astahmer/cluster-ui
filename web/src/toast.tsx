import * as React from "react"
import { createRoot } from "react-dom/client"

/**
 * Minimal toast system. Self-mounting: on first emit it attaches a viewport
 * to document.body, so no page/shell integration is required.
 *
 *   toast.success("Message retried")
 *   toast.error(`Retry failed: ${msg}`)
 */

type ToastTone = "success" | "error" | "info"

interface ToastEntry {
  id: number
  tone: ToastTone
  message: string
}

let nextId = 1
const entries: ToastEntry[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function notify() {
  listeners.forEach((fn) => fn())
}

function dismiss(id: number) {
  const idx = entries.findIndex((e) => e.id === id)
  if (idx !== -1) entries.splice(idx, 1)
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  notify()
}

function emit(tone: ToastTone, message: string) {
  const id = nextId++
  const ttl = tone === "error" ? 8000 : 4000
  entries.push({ id, tone, message })
  timers.set(id, setTimeout(() => dismiss(id), ttl))
  mount()
  notify()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const toast = {
  success: (message: string) => emit("success", message),
  error: (message: string) => emit("error", message),
  info: (message: string) => emit("info", message)
}

/** Escape hatch to remove a toast programmatically. */
export function dismissToast(id: number) {
  dismiss(id)
}

const TONE_ACCENT: Record<ToastTone, string> = {
  success: "bg-kumo-success",
  error: "bg-kumo-danger",
  info: "bg-kumo-info"
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-80 items-stretch overflow-hidden rounded-md border border-kumo-line bg-kumo-base shadow-lg"
    >
      <div className={`w-1 shrink-0 ${TONE_ACCENT[entry.tone]}`} />
      <div className="flex flex-1 items-start gap-2 px-3 py-2.5">
        <p className="flex-1 text-[13px] leading-5 text-kumo-default">{entry.message}</p>
        <button
          type="button"
          aria-label="Dismiss notification"
          className="-m-1 rounded p-1 text-[11px] leading-none text-kumo-inactive hover:text-kumo-default"
          onClick={() => dismiss(entry.id)}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function ToastStack() {
  if (entries.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {entries.map((entry) => (
        <ToastCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

// --- imperative self-mount -------------------------------------------------

let mountedRoot: ReturnType<typeof createRoot> | null = null

export function mount() {
  if (mountedRoot || typeof document === "undefined") return
  const el = document.createElement("div")
  el.dataset.toastViewport = ""
  document.body.appendChild(el)
  mountedRoot = createRoot(el)
  subscribe(() => mountedRoot?.render(<ToastStack />))
  mountedRoot.render(<ToastStack />)
}

/**
 * Declarative alternative for apps that want the viewport inside their own
 * tree instead of self-mounted on body. No-op when the imperative viewport
 * already took over.
 */
export function ToastViewport() {
  return mountedRoot ? null : <ToastStack />
}
