import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"
import { api, clusterRepos } from "./api.ts"
import { authorization } from "./auth.ts"
import { config } from "./config.ts"
import * as metrics from "./metrics.ts"
import { startAlertMonitor } from "./ops.ts"

const ServerLive = NodeHttpServer.layer(() => createServer(), {
  port: config.port,
  host: config.host
})

// token auth wraps every request; the middleware itself no-ops when CLUSTER_UI_TOKEN is unset
const AppRoutes = HttpRouter.addAll(api)
const AuthMiddleware = HttpRouter.use((router) => router.addGlobalMiddleware(authorization))

const Main = HttpRouter.serve(Layer.mergeAll(AppRoutes, AuthMiddleware)).pipe(
  Layer.provide(ServerLive),
  Layer.provide(metrics.samplerLayer(clusterRepos)),
  Layer.launch
)

startAlertMonitor(clusterRepos)
NodeRuntime.runMain(Main)

// Exit abruptly on signals: letting node unwind naturally finalizes
// better-sqlite3 Statements during GC after env teardown, which trips a
// native assertion (RemoveEnvironmentCleanupHook) under watch restarts.
process.on("SIGINT", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))
