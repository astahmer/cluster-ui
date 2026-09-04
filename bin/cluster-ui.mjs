#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))

function usage() {
  console.log(`Usage: cluster-ui [target]

Serve the prebuilt cluster-ui dashboard and API.

Target may be a SQLite path, postgres:// URL, or redis:// URL.
When omitted, CLUSTER_UI_CLUSTERS may configure multiple targets.

Environment:
  PORT, HOST, CLUSTER_UI_PREFIX, CLUSTER_UI_READONLY
  CLUSTER_UI_TOKEN, CLUSTER_UI_STATE_FILE`)
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  usage()
  process.exit(0)
}
if (args.includes("--version") || args.includes("-v")) {
  console.log(packageJson.version)
  process.exit(0)
}
if (args.some((arg) => arg.startsWith("-"))) {
  console.error("Unknown option. Run `cluster-ui --help` for usage.")
  process.exit(2)
}
if (args.length > 1) {
  console.error("Expected at most one connection target.")
  process.exit(2)
}
if ((args[0] || process.env.CLUSTER_UI_TARGET) && process.env.CLUSTER_UI_CLUSTERS) {
  console.error("Do not combine a connection target with CLUSTER_UI_CLUSTERS.")
  process.exit(2)
}

const target = args[0] ?? process.env.CLUSTER_UI_TARGET
if (target === "") {
  console.error("Connection target must not be empty.")
  process.exit(2)
}
if (target && !isTarget(target)) {
  console.error("Connection target must be a SQLite path or a postgres://, redis://, or rediss:// URL.")
  process.exit(2)
}

const server = resolve(packageRoot, "server/dist/main.cjs")
const dist = resolve(packageRoot, "dist")
if (!existsSync(server) || !existsSync(resolve(dist, "index.html"))) {
  console.error("cluster-ui is not built. Run `pnpm build` before starting it.")
  process.exit(1)
}

const env = { ...process.env, CLUSTER_UI_DIST: dist }
if (target) {
  env.CLUSTER_UI_CLUSTERS = `default=${target}`
  delete env.CLUSTER_UI_TARGET
}
const child = spawn(process.execPath, [server], {
  cwd: process.cwd(),
  env,
  stdio: "inherit"
})

let stopping = false
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!stopping) {
      stopping = true
      child.kill(signal)
    }
  })
}
child.on("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})

function isTarget(value) {
  if (value.startsWith("redis://") || value.startsWith("rediss://") || value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    try {
      const url = new URL(value)
      return Boolean(url.hostname)
    } catch {
      return false
    }
  }
  if (value.includes("://")) return false
  return !value.includes("\0") && value.trim().length > 0
}
