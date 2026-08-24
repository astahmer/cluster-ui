import * as React from "react"

/**
 * Freshness tracking: pages report successful fetches via `markFresh()` and
 * the shell renders a ticking "updated Ns ago" indicator via `useFreshness()`.
 */

let lastSuccessAt: number | null = null
const subscribers = new Set<() => void>()

export function markFresh(t: number = Date.now()) {
  lastSuccessAt = t
  subscribers.forEach((fn) => fn())
}

export function useFreshness(): { lastSuccessAt: number | null; secondsAgo: number | null } {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    const sub = () => setTick((t) => t + 1)
    subscribers.add(sub)
    return () => {
      clearInterval(interval)
      subscribers.delete(sub)
    }
  }, [])
  void tick
  return {
    lastSuccessAt,
    secondsAgo: lastSuccessAt === null ? null : Math.max(0, Math.round((Date.now() - lastSuccessAt) / 1000))
  }
}
