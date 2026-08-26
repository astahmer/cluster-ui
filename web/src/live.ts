import * as React from "react"
import { eventsUrl, getCluster, onClusterChange } from "./api.ts"
import { markFresh } from "./freshness.ts"

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

type DownSubscriber = (down: boolean) => void

const subscribers = new Set<Subscriber>()
const downSubscribers = new Set<DownSubscriber>()
const pauseSubscribers = new Set<(paused: boolean) => void>()

let paused = false
let source: EventSource | null = null
let fallbackTimer: ReturnType<typeof setInterval> | null = null

// bus health: a wakeup source is "down" when it failed and no success came after
let sseFailed = false
let pollFailed = false

function setSseFailed(next: boolean) {
  if (sseFailed === next) return
  sseFailed = next
  recomputeBusDown()
}

function setPollFailed(next: boolean) {
  if (pollFailed === next) return
  pollFailed = next
  recomputeBusDown()
}

function recomputeBusDown() {
  const next = source === null ? sseFailed && pollFailed && fallbackTimer !== null : sseFailed
  if (next !== busDown) {
    busDown = next
    downSubscribers.forEach((fn) => fn(busDown))
  }
}

let busDown = false

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
  fallbackTimer = setInterval(() => {
    notify()
    // Keep polling while periodically retrying SSE. Clearing this timer before
    // connect() avoids the non-null guard turning fallback into a permanent mode.
    if (source === null) {
      clearInterval(fallbackTimer!)
      fallbackTimer = null
      connect()
    }
  }, 4000)
}

function connect() {
  if (source !== null || fallbackTimer !== null) return
  try {
    const es = new EventSource(eventsUrl())
    es.addEventListener("overview", notify as EventListener)
    es.addEventListener("overview", () => setSseFailed(false) as unknown as EventListener)
    es.onerror = () => {
      es.close()
      source = null
      setSseFailed(true)
      // stream unavailable (proxy, auth, older server) → poll instead
      startFallback()
    }
    source = es
  } catch {
    setSseFailed(true)
    startFallback()
  }
}

/** Close the SSE stream (used when the selected cluster changes). */
function disconnect() {
  if (source !== null) {
    source.close()
    source = null
  }
}

// the stream describes one cluster — reopen it when the selection changes so
// wakeup cadence and bus-down signal reflect the right cluster (UX audit #2)
let sseCluster: string | null = getCluster()
onClusterChange((next) => {
  if (next === sseCluster) return
  sseCluster = next
  // if SSE is healthy, bounce it; if we're on fallback polling, polling is
  // cluster-agnostic (pages fetch with their own ?cluster=) — just clear the
  // failure state so SSE gets another chance on the next subscribe cycle
  if (source !== null) {
    disconnect()
    setSseFailed(false)
    connect()
  } else {
    setSseFailed(false)
  }
})

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

/** True when every wakeup source has recently failed — shell renders a banner. */
export function isBusDown(): boolean {
  return busDown
}

/** Subscribe to bus-health changes; returns an unsubscribe function. */
export function onBusDownChange(fn: (down: boolean) => void): () => void {
  downSubscribers.add(fn)
  return () => {
    downSubscribers.delete(fn)
  }
}

/** Pause refreshes while `open` is true; restores the previous state on close/unmount. */
export function usePauseWhile(open: boolean) {
  const restoreRef = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (!open) {
      if (restoreRef.current !== null) {
        setPaused(restoreRef.current)
        restoreRef.current = null
      }
      return
    }
    if (restoreRef.current === null) restoreRef.current = paused
    setPaused(true)
    return () => {
      if (restoreRef.current !== null) {
        setPaused(restoreRef.current)
        restoreRef.current = null
      }
    }
  }, [open])
}

export interface LiveHandle {
  loading: boolean
  error: string | null
  /** force one immediate refetch */
  refresh: () => void
}

export function useLive(fetcher: () => Promise<unknown>, deps: unknown[] = [], enabled = true): LiveHandle {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)

  const fetchRef = React.useRef(fetcher)
  fetchRef.current = fetcher

  React.useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      try {
        await fetchRef.current()
        if (alive) {
          setError(null)
          setPollFailed(false)
          markFresh()
        }
      } catch (e) {
        if (alive) {
          setError(String(e))
          // only meaningful while polling is the active source; SSE pages also
          // fetch on wake, so track failures regardless of transport
          setPollFailed(true)
        }
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
  }, [enabled, ...deps, tick])

  return { loading, error, refresh: () => setTick((t) => t + 1) }
}
