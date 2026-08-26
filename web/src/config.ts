import * as React from "react"
import { api } from "./api.ts"

/**
 * Shared app-config cache + hook (moved from Messages.tsx so every page sees
 * the same config object — e.g. `readonly` gating and tracingUrlTemplate).
 * Dispatch `window.dispatchEvent(new CustomEvent("ui:config"))` after
 * invalidating to re-render consumers.
 */
type AppConfig = Awaited<ReturnType<typeof api.config>>

let configCache: AppConfig | null = null
let inflight: Promise<AppConfig> | null = null

export function getConfigCached(): AppConfig | null {
  return configCache
}

/** Refetch config and notify subscribers (exported for future invalidation). */
export function refreshConfig(): Promise<AppConfig> {
  inflight = api.config()
  return inflight
    .then((c) => {
      configCache = c
      window.dispatchEvent(new CustomEvent("ui:config"))
      return c
    })
    .finally(() => {
      inflight = null
    })
}

export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = React.useState<AppConfig | null>(configCache)
  React.useEffect(() => {
    let alive = true
    if (configCache === null && inflight === null) {
      refreshConfig().catch(() => {})
    }
    const sync = () => alive && setConfig(configCache)
    sync()
    window.addEventListener("ui:config", sync)
    return () => {
      alive = false
      window.removeEventListener("ui:config", sync)
    }
  }, [])
  return config
}
