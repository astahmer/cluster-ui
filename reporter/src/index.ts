import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect, Layer } from "effect"

/**
 * @effect/cluster-ui-reporter
 *
 * Optional ~100 LOC reporter that makes runner-resident state visible to
 * cluster-ui. Mount it in your Effect 4 runner app; the dashboard discovers
 * every runner's host:port from its SQL storage and fans out to this endpoint.
 *
 * Serves: GET /internal/cluster-ui/state
 *   {
 *     "singletons": [{ "name": "MyService", "address": "host:port", "startedAt": 1712... }],
 *     "entitiesInMemory": 12,
 *     "registeredEntityTypes": ["Mailbox", "Session"]
 *   }
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
}

export function makeReporterLayer(sharding: ReporterSharding): Layer.Layer<never> {
  const router = HttpRouter.get("/internal/cluster-ui/state", Effect.succeed(HttpServerResponse.json({
    singletons: [...sharding.getSingletons()],
    registeredEntityTypes: [...sharding.getEntityTypes()],
    ...(sharding.size() === null ? {} : { entitiesInMemory: sharding.size() })
  })))
  // merge into whatever router/HttpApi the host app already serves, or mount standalone:
  return Layer.effectDiscard(Effect.void).pipe(Layer.provideMerge(router as never)) as never
}
