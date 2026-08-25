import type { Repo } from "./queries.ts"

/**
 * Runner-resident state visibility.
 *
 * Singleton/entity state, logs and fibers never touch SQL — they only exist
 * inside each runner. Runners that mount the optional
 * `@effect/cluster-ui-reporter` package expose them at
 * GET /internal/cluster-ui/{state,logs,fibers}; this module fans out to every
 * known runner address and aggregates the responses, isolating failures per
 * runner (unreachable runners become error entries, never thrown).
 */

export interface ReporterSingleton {
  name: string
  address?: string | null
  startedAt?: number | string | null
}

export interface ReporterState {
  singletons?: ReporterSingleton[]
  entitiesInMemory?: number
  registeredEntityTypes?: string[]
}

export interface RunnerReport {
  address: string
  state?: ReporterState
  error?: string
}

export interface ReporterLogLine {
  t: number
  level?: string | null
  text: string
}

export interface RunnerLogsReport {
  address: string
  lines?: ReporterLogLine[]
  error?: string
}

export interface ReporterFiber {
  id: string
  name?: string | null
  status: string
  startedAt?: number | string | null
  children?: number | null
}

export interface RunnerFibersReport {
  address: string
  fibers?: ReporterFiber[]
  error?: string
}

const TIMEOUT_MS = 2000
const CACHE_TTL_MS = 10_000

const cache = new Map<string, { at: number; body: unknown }>()

async function fetchRunnerJson<T>(
  address: string,
  path: string,
  ttlMs = CACHE_TTL_MS,
  timeoutMs = TIMEOUT_MS
): Promise<T> {
  const key = `${address}${path}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < ttlMs) return cached.body as T

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://${address}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as T
    cache.set(key, { at: Date.now(), body })
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function fanOut<T>(
  repo: Repo,
  pathFor: (address: string) => string,
  ttlMs: number,
  wrap: (address: string, data: unknown) => T,
  onError: (address: string, message: string) => T
): Promise<{ runners: T[] }> {
  const addresses = [...new Set(repo.runners().map((r) => r.address))]
  const reports = await Promise.all(
    addresses.map(async (address) => {
      try {
        return wrap(address, await fetchRunnerJson<unknown>(address, pathFor(address), ttlMs))
      } catch (e) {
        // unreachable runners are a normal condition (no reporter mounted) —
        // surface them as per-runner errors, never throw
        return onError(address, e instanceof Error ? e.message : String(e))
      }
    })
  )
  // reports carry their own address; restore stable ordering for the UI
  ;(reports as Array<{ address?: string }>).sort((a, b) =>
    String(a.address ?? "").localeCompare(String(b.address ?? ""))
  )
  return { runners: reports }
}

/** Singletons + entity-memory snapshot (GET /internal/cluster-ui/state). */
export async function queryRunnerState(repo: Repo): Promise<{ runners: RunnerReport[] }> {
  return fanOut<RunnerReport>(
    repo,
    () => "/internal/cluster-ui/state",
    CACHE_TTL_MS,
    (address, data) => ({ address, state: data as ReporterState }),
    (address, error) => ({ address, error })
  )
}

/**
 * Recent log lines per reporting runner.
 * `sinceMs` filters server-side when the reporter supports it; results are
 * cached briefly (3s) so live tails stay responsive without hammering runners.
 */
export async function queryRunnerLogs(
  repo: Repo,
  sinceMs?: number,
  limit = 200
): Promise<{ runners: RunnerLogsReport[] }> {
  const path = `/internal/cluster-ui/logs?limit=${Math.min(Math.max(limit, 1), 1000)}${
    sinceMs ? `&since=${sinceMs}` : ""
  }`
  return fanOut<RunnerLogsReport>(
    repo,
    () => path,
    3_000,
    (address, data) => ({
      address,
      lines: ((data as { lines?: unknown[] } | null)?.lines ?? []) as ReporterLogLine[]
    }),
    (address, error) => ({ address, error })
  )
}

/** Live fiber/supervisor snapshots per reporting runner. */
export async function queryRunnerFibers(repo: Repo): Promise<{ runners: RunnerFibersReport[] }> {
  return fanOut<RunnerFibersReport>(
    repo,
    () => "/internal/cluster-ui/fibers",
    CACHE_TTL_MS,
    (address, data) => ({
      address,
      fibers: ((data as { fibers?: unknown[] } | null)?.fibers ?? []) as ReporterFiber[]
    }),
    (address, error) => ({ address, error })
  )
}
