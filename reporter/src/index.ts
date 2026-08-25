import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Layer } from "effect"

/**
 * @effect/cluster-ui-reporter
 *
 * Optional ~100 LOC reporter that makes runner-resident state visible to
 * cluster-ui. Mount it in your Effect 4 runner app; the dashboard discovers
 * every runner's host:port from its SQL storage and fans out to these endpoints.
 *
 * Serves:
 *
 * GET /internal/cluster-ui/state
 *   {
 *     "singletons": [{ "name": "MyService", "address": "host:port", "startedAt": 1712... }],
 *     "entitiesInMemory": 12,
 *     "registeredEntityTypes": ["Mailbox", "Session"]
 *   }
 *
 * GET /internal/cluster-ui/logs?since=<ms>&limit=<n>
 *   { "lines": [{ "t": 1712..., "level": "info", "text": "..." }] }
 *   (only when an optional `logs` provider is given)
 *
 * GET /internal/cluster-ui/fibers
 *   { "fibers": [{ "id": "#123", "name": "worker-1", "status": "running",
 *                  "startedAt": 1712..., "children": 2 }] }
 *   (only when an optional `fibers` provider is given)
 *
 * All fields are optional and degrade gracefully — report whatever your
 * Sharding service can give you.
 */

/** Minimal structural view of a Sharding service. Adapt yours in ~3 lines. */
export interface ReporterSharding {
  /** currently-active singleton entities on this runner */
  getSingletons(): Iterable<{
    name: string
    address?: string | null
    startedAt?: number | string | null
  }>
  /** entity types registered with this runner's Sharding service */
  getEntityTypes(): Iterable<string>
  /** rough count of entities held in memory (null when unknown) */
  size(): number | null
  /** OPTIONAL: recent log lines, oldest first. Wire your logger here. */
  logs?(sinceMs?: number, limit?: number): Iterable<{ t: number; level?: string | null; text: string }>
  /** OPTIONAL: live fiber/supervisor snapshot from your runtime. */
  fibers?(): Iterable<{
    id: string
    name?: string | null
    status: string
    startedAt?: number | string | null
    children?: number | null
  }>
}

export function makeReporterLayer(sharding: ReporterSharding): Layer.Layer<never> {
  const stateRoute = HttpRouter.get("/internal/cluster-ui/state", Effect.succeed(HttpServerResponse.json({
    singletons: [...sharding.getSingletons()],
    registeredEntityTypes: [...sharding.getEntityTypes()],
    ...(sharding.size() === null ? {} : { entitiesInMemory: sharding.size() })
  })))

  const logsRoute = sharding.logs ?
    HttpRouter.get("/internal/cluster-ui/logs", Effect.map(
      HttpServerRequest.HttpServerRequest,
      (req) => {
        const url = new URL(req.url, "http://localhost")
        const sinceRaw = Number(url.searchParams.get("since") ?? "0")
        const limitRaw = Number(url.searchParams.get("limit") ?? "200")
        const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : undefined
        const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 1000)
        const lines = [...sharding.logs!(since, limit)]
          .filter((l) => since === undefined || !(typeof l.t === "number") || l.t >= since)
          .slice(-limit)
        return Effect.succeed(HttpServerResponse.json({ lines }))
      }
    )) :
    undefined

  const fibersRoute =
    HttpRouter.get("/internal/cluster-ui/fibers", Effect.succeed(HttpServerResponse.json({
      fibers: sharding.fibers ? [...sharding.fibers()] : []
    })))

  const router = [stateRoute, logsRoute, fibersRoute].filter(Boolean) as never[]
  // merge into whatever router/HttpApi the host app already serves, or mount standalone:
  return Layer.effectDiscard(Effect.void).pipe(Layer.provideMerge(HttpRouter.concatAll(router) as never)) as never
}
