import * as React from "react"

/**
 * Shared live-refresh bus.
 *
 * - While LIVE, a single EventSource listens to `/api/events` (SSE "overview"
 *   events emitted by the server every ~5s) and wakes all subscribers.
 * - If SSE fails (e.g. proxy without streaming support, auth mismatch), it
 *   transparently falls back to 4s interval polling.
 * - While PAUSED no wakeups are delivered; pages keep showing stale data.
 *
 * Pages consume this via `useLive(fetcher, deps)` which has the same
 * ergonomics as the former `usePolling` ({ loading, error, refresh }).
 */

type Subscriber = () => void

const subscribers = new Set<Subscriber>()
const pauseSubscribers = new Set<(paused: boolean) => void>()

let paused = false
let source: EventSource | null = null
let fallbackTimer: ReturnType<typeof setInterval> | null = null

function notify() {
  if (paused) return
  subscribers.forEach((fn) => {
    try {
      fn()
    } catch {
      /* subscriber errors are handled inside each hook */
    }
  })
}

function startFallback() {
  if (fallbackTimer !== null) return
  fallbackTimer = setInterval(notify, 4000)
}

function connect() {
  if (source !== null || fallbackTimer !== null) return
  try {
    const es = new EventSource("/api/events")
    es.addEventListener("overview", notify as EventListener)
    es.onerror = () => {
      es.close()
      source = null
      // stream unavailable (proxy, auth, older server) → poll instead
      startFallback()
    }
    source = es
  } catch {
    startFallback()
  }
}

export function isPaused(): boolean {
  return paused
}

export function setPaused(next: boolean) {
  paused = next
  pauseSubscribers.forEach((fn) => fn(next))
  if (!next) notify()
}

export function triggerRefresh() {
  notify()
}

export function usePaused(): [boolean, (next: boolean) => void] {
  const [value, setValue] = React.useState(paused)
  React.useEffect(() => {
    pauseSubscribers.add(setValue)
    return () => {
      pauseSubscribers.delete(setValue)
    }
  }, [])
  return [value, setPaused]
}

export interface LiveHandle {
  loading: boolean
  error: string | null
  /** force one immediate refetch */
  refresh: () => void
}

export function useLive(fetcher: () => Promise<unknown>, deps: unknown[] = []): LiveHandle {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)

  const fetchRef = React.useRef(fetcher)
  fetchRef.current = fetcher

  React.useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        await fetchRef.current()
        if (alive) setError(null)
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    connect()
    subscribers.add(load)
    return () => {
      alive = false
      subscribers.delete(load)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { loading, error, refresh: () => setTick((t) => t + 1) }
}
