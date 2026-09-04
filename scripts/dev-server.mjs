#!/usr/bin/env node
import { context } from "esbuild"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

let child
let stopping = false
let restarting = false

const options = {
  entryPoints: ["server/src/main.ts"],
  outfile: "server/dist/main.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  nodePaths: [resolve("node_modules")],
  target: "node20",
  sourcemap: true,
  external: [
    "@parcel/watcher",
    "better-sqlite3",
    "ioredis",
    "postgres",
    "undici",
    "ws"
  ],
  plugins: [{
    name: "restart-server",
    setup(build) {
      build.onEnd(async (result) => {
        if (stopping || !child || result.errors.length > 0) return
        restarting = true
        child.kill("SIGTERM")
        await new Promise((resolve) => child.once("exit", resolve))
        restarting = false
        if (!stopping) startServer()
      })
    }
  }]
}

await mkdir("server/dist", { recursive: true })
const builder = await context(options)
await builder.rebuild()
startServer()
await builder.watch()

function startServer() {
  child = spawn(process.execPath, ["server/dist/main.cjs"], {
    env: { ...process.env, CLUSTER_UI_DIST: `${process.cwd()}/dist` },
    stdio: "inherit"
  })
  child.on("error", () => stop(1))
  child.on("exit", (code, signal) => {
    if (!stopping && !restarting) stop(code ?? (signal ? 1 : 0))
  })
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  child?.kill("SIGTERM")
  void builder.dispose().finally(() => {
    process.exitCode = code
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop())
}
