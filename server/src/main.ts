import { HttpServer } from "@effect/platform"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import { Layer } from "effect"
import { createServer } from "node:http"
import { api } from "./api.ts"
import { config } from "./config.ts"

const ServerLive = NodeHttpServer.layer(() => createServer(), {
  port: config.port,
  host: config.host
})

const Main = api.pipe(
  HttpServer.serve(),
  Layer.provide(ServerLive),
  Layer.launch
)

NodeRuntime.runMain(Main)
