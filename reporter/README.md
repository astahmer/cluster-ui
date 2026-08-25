# @effect/cluster-ui-reporter

Optional companion package for [cluster-ui](../README.md): exposes runner-resident
state (singletons, in-memory entity counts) over HTTP so the dashboard can show it.

## Why

`Sharding`'s singleton/entity map is **in-memory only** — no storage-backed dashboard
can see it. This package adds a tiny read-only endpoint inside each of your runners;
cluster-ui already knows every runner's `host:port` from the SQL storage and fans out.

## Usage

Adapt your `Sharding` service to the 3-method structural interface (~3 lines), then
mount the route on your existing HTTP layer:

```ts
import { makeReporterLayer, type ReporterSharding } from "@effect/cluster-ui-reporter"

const sharding: ReporterSharding = {
  getSingletons: () => shardingLive.singletons,        // adapt to your API
  getEntityTypes: () => shardingLive.registered,
  size: () => shardingLive.entityCount,
  // optional — enables the dashboard's Runtime tab:
  logs: (sinceMs, limit) => logger.recent({ since: sinceMs, limit }),   // oldest first
  fibers: () => runtime.fiberSnapshot()                                 // live fiber state
}

// merge HttpRouter routes from makeReporterLayer(sharding) into your server,
// or serve it on its own port per runner.
```

Endpoints served:

```
GET /internal/cluster-ui/state
{
  "singletons": [{ "name": "MySingleton", "address": "10.0.4.11:8080", "startedAt": 1724500000000 }],
  "registeredEntityTypes": ["Mailbox", "Session"],
  "entitiesInMemory": 12
}

GET /internal/cluster-ui/logs?since=<ms>&limit=<n>     (needs the `logs` provider)
{ "lines": [{ "t": 1724500000000, "level": "info", "text": "..." }] }

GET /internal/cluster-ui/fibers                        (needs the `fibers` provider)
{ "fibers": [{ "id": "#123", "name": "worker-1", "status": "running",
               "startedAt": 1724500000000, "children": 2 }] }
```

Runners without this package simply show as "reporter not reachable" in the
dashboard — everything else keeps working.
