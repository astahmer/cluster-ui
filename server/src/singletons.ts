import type { Repo } from "./queries.ts"

/**
 * Singleton/entity-memory visibility.
 *
 * Runner-resident state (singletons, in-memory entities) never touches SQL —
 * it only exists inside each runner's Sharding service. Runners that mount the
 * optional `@effect/cluster-ui-reporter` package expose it at
 * GET /internal/cluster-ui/state; this module fans out to every known runner
 * address and aggregates the responses, isolating failures per runner.
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

const TIMEOUT_MS = 2000
const CACHE_TTL_MS = 10_000

const cache = new Map<string, { at: number; report: RunnerReport }>()

async function fetchRunner(address: string): Promise<RunnerReport> {
  const cached = cache.get(address)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.report

  let report: RunnerReport
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`http://${address}/internal/cluster-ui/state`, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      })
      if (!res.ok) {
        report = { address, error: `HTTP ${res.status}` }
      } else {
        report = { address, state: (await res.json()) as ReporterState }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    // unreachable runners are a normal condition (no reporter mounted) —
    // surface them as per-runner errors, never throw
    report = { address, error: e instanceof Error ? e.message : String(e) }
  }

  cache.set(address, { at: Date.now(), report })
  return report
}

export async function queryRunnerState(repo: Repo): Promise<{ runners: RunnerReport[] }> {
  const addresses = [...new Set(repo.runners().map((r) => r.address))]
  const reports = await Promise.all(addresses.map((address) => fetchRunner(address)))
  reports.sort((a, b) => a.address.localeCompare(b.address))
  return { runners: reports }
}
