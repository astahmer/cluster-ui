#!/usr/bin/env node
/** Isolated SQLite + Redis fixture server for Playwright BDD. */
import { createServer } from "node:net"
import { spawn, execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const PORT = 8797
const db = `/tmp/cluster-ui-pw-bdd-${process.pid}.db`
const state = `/tmp/cluster-ui-pw-bdd-${process.pid}.json`

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

function wait(ms) { return new Promise((resolveWait) => setTimeout(resolveWait, ms)) }

const redisPort = await freePort()
const redis = spawn("redis-server", ["--port", String(redisPort), "--daemonize", "no", "--save", ""], {
  cwd: ROOT,
  stdio: "ignore"
})
await wait(500)

const nodeArgs = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/register-ts-resolve.mjs"]
const seed = spawn(process.execPath, [...nodeArgs, "server/src/seed.ts"], {
  cwd: ROOT,
  env: { ...process.env, CLUSTER_UI_DB: db, CLUSTER_UI_STATE_FILE: state },
  stdio: "inherit"
})
const seedExit = await new Promise((resolveExit, reject) => {
  seed.once("error", reject)
  seed.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
})
if (seedExit !== 0) throw new Error(`SQLite seed failed (${seedExit})`)

execFileSync(process.execPath, ["scripts/demo-redis.mjs"], {
  cwd: ROOT,
  env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${redisPort}` },
  stdio: "inherit"
})

const server = spawn(process.execPath, [...nodeArgs, "server/src/main.ts"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    CLUSTER_UI_DB: db,
    CLUSTER_UI_STATE_FILE: state,
    CLUSTER_UI_CLUSTERS: `default=${db},local-redis=redis://127.0.0.1:${redisPort}`
  },
  stdio: "inherit"
})

let stopping = false
function stop(signal = "SIGTERM") {
  if (stopping) return
  stopping = true
  server.kill(signal)
  redis.kill(signal)
}
process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))

const code = await new Promise((resolveExit, reject) => {
  server.once("error", reject)
  server.once("exit", (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)))
})
stop()
process.exit(code)
