import { HttpServer } from "@effect/platform"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import { Layer } from "effect"
import { createServer } from "node:http"
import { api, clusterRepos } from "./api.ts"
import { authorization } from "./auth.ts"
import { config } from "./config.ts"
import * as metrics from "./metrics.ts"

const ServerLive = NodeHttpServer.layer(() => createServer(), {
  port: config.port,
  host: config.host
})

// token auth wraps every request when CLUSTER_UI_TOKEN is configured
const app = (config.authToken ? authorization(api) : api) as typeof api

const Main = app.pipe(
  HttpServer.serve(),
  Layer.provide(ServerLive),
  Layer.provide(metrics.samplerLayer(clusterRepos)),
  Layer.launch
)

NodeRuntime.runMain(Main)
