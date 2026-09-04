#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const env = { ...process.env }
try {
  const dotenv = await readFile(resolve(root, ".env"), "utf8")
  for (const line of dotenv.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match && env[match[1]] === undefined) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2")
  }
} catch {}

const children = [
  spawn("pnpm", ["dev:web"], { cwd: root, env, stdio: "inherit" }),
  spawn("pnpm", ["dev:server"], { cwd: root, env, stdio: "inherit" })
]
let stopping = false
let exitCode = 0

function stop(code = 0) {
  if (stopping) return
  stopping = true
  exitCode = code
  for (const child of children) child.kill("SIGTERM")
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop())
}
for (const child of children) {
  child.on("error", () => stop(1))
  child.on("exit", (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0))
    if (children.every((candidate) => candidate.exitCode !== null || candidate.signalCode !== null)) {
      process.exitCode = exitCode
    }
  })
}
