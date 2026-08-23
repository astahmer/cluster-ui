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
}

const SAMPLE_INTERVAL_MS = 10_000
const RETENTION_MS = 60 * 60 * 1000

/** per-cluster series */
const byName = new Map<string, Array<MetricSample>>()
/** aggregated across all clusters (aligned to sample time) */
const aggregate: Array<MetricSample> = []

function takeSample(repos: ReadonlyArray<[string, Repo]>) {
  const t = Date.now()
  const totals = { pending: 0, inflight: 0, scheduled: 0, done: 0, failed: 0, unassignedShards: 0 }
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
        unassignedShards: ov.unassignedShards
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
