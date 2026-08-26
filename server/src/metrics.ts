import { Effect, Layer } from "effect"
import type { Repo } from "./queries.ts"

/**
 * In-memory metrics ring buffer. A background fiber samples every repo's
 * overview counters every ~10s and retains >=60 minutes of history.
 */

export interface MetricSample {
  readonly t: number
  readonly pending: number
  readonly inflight: number
  readonly scheduled: number
  readonly done: number
  readonly failed: number
  readonly unassignedShards: number
  readonly runners: number
}

const SAMPLE_INTERVAL_MS = 10_000
// 8 days retained so the UI's 7d range has data (age-pruned in push());
// 7d at ~10s would be ~60k points, so a hard per-series cap below keeps
// memory bounded if sampling ever runs faster than the nominal interval
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000
/** oldest-dropped-first ceiling per series (~3.5 days at 10s cadence) */
const MAX_SAMPLES_PER_SERIES = 30_000

/** per-cluster series */
const byName = new Map<string, Array<MetricSample>>()
/** aggregated across all clusters (aligned to sample time) */
const aggregate: Array<MetricSample> = []

function takeSample(repos: ReadonlyArray<[string, Repo]>) {
  const t = Date.now()
  const totals = { pending: 0, inflight: 0, scheduled: 0, done: 0, failed: 0, unassignedShards: 0, runners: 0 }
  for (const [name, repo] of repos) {
    try {
      const ov = repo.overview()
      const s: MetricSample = {
        t,
        pending: ov.messages.pending,
        inflight: ov.messages.inflight,
        scheduled: ov.messages.scheduled,
        done: ov.messages.done,
        failed: ov.messages.failed,
        unassignedShards: ov.unassignedShards,
        runners: ov.runners.total
      }
      let series = byName.get(name)
      if (!series) {
        series = []
        byName.set(name, series)
      }
      push(series, s)
      totals.pending += s.pending
      totals.inflight += s.inflight
      totals.scheduled += s.scheduled
      totals.done += s.done
      totals.failed += s.failed
      totals.unassignedShards += s.unassignedShards
      totals.runners += s.runners
    } catch {
      // a broken cluster db must not kill sampling of the others
    }
  }
  push(aggregate, { t, ...totals })
}

function push(buf: Array<MetricSample>, sample: MetricSample) {
  buf.push(sample)
  const cutoff = Date.now() - RETENTION_MS
  let drop = 0
  while (drop < buf.length && buf[drop].t < cutoff) drop++
  // hard cap: drop the oldest beyond MAX_SAMPLES_PER_SERIES regardless of age
  const overCap = buf.length - MAX_SAMPLES_PER_SERIES
  if (overCap > drop) drop = overCap
  if (drop > 0) buf.splice(0, drop)
}

export function recordSample(repos: ReadonlyArray<[string, Repo]>): void {
  takeSample(repos)
}

/** oldest-first history; `cluster` narrows to one cluster, default aggregates all */
export function history(cluster?: string): Array<MetricSample> | null {
  if (cluster === undefined || cluster === "") return aggregate.slice()
  const series = byName.get(cluster)
  return series ? series.slice() : null
}

/** Latest sample per cluster, for the Prometheus exposition. */
function latestPerCluster(): Array<[string, MetricSample]> {
  return [...byName.entries()]
    .map(([name, series]) => [name, series[series.length - 1]] as [string, MetricSample])
    .filter((entry) => entry[1] !== undefined)
}

const PROM_STATES = ["pending", "inflight", "scheduled", "done", "failed"] as const

/**
 * Prometheus text exposition (format version 0.0.4) of the latest sampled
 * counters per cluster.
 */
export function prometheus(): string {
  const multi = byName.size > 1
  const lines: string[] = []
  lines.push("# HELP cluster_ui_messages Messages in storage by state.")
  lines.push("# TYPE cluster_ui_messages gauge")
  for (const [name, s] of latestPerCluster()) {
    for (const state of PROM_STATES) {
      lines.push(`cluster_ui_messages${multi ? `{cluster="${name}",state="${state}"}` : `{state="${state}"}`} ${s[state]}`)
    }
  }
  if (!multi && aggregate.length > 0) {
    const a = aggregate[aggregate.length - 1]
    for (const state of PROM_STATES) {
      lines.push(`cluster_ui_messages{state="${state}"} ${a[state]}`)
    }
  }
  lines.push("# HELP cluster_ui_unassigned_shards Shards not owned by any runner.")
  lines.push("# TYPE cluster_ui_unassigned_shards gauge")
  for (const [name, s] of latestPerCluster()) {
    lines.push(`cluster_ui_unassigned_shards${multi ? `{cluster="${name}"}` : ""} ${s.unassignedShards}`)
  }
  lines.push("# HELP cluster_ui_runners Registered runners.")
  lines.push("# TYPE cluster_ui_runners gauge")
  for (const [name, s] of latestPerCluster()) {
    lines.push(`cluster_ui_runners${multi ? `{cluster="${name}"}` : ""} ${s.runners}`)
  }
  return lines.join("\n") + "\n"
}

/** Background sampler fiber as a Layer; samples immediately, then every ~10s. */
export const samplerLayer = (
  getRepos: () => ReadonlyArray<[string, Repo]>
): Layer.Layer<never> =>
  // fork so layer acquisition completes; fiber lives for the layer's scope
  Layer.effectDiscard(
    Effect.forkDaemon(
      Effect.forever(
        Effect.andThen(
          Effect.sync(() => recordSample(getRepos())),
          Effect.sleep(SAMPLE_INTERVAL_MS)
        )
      ).pipe(Effect.ignore)
    )
  )
