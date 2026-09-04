#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { spawn } from "node:child_process"

const root = resolve(import.meta.dirname, "..")
const cli = resolve(root, "bin/cluster-ui.mjs")

function run(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("exit", (code) => resolveRun({ code, stdout, stderr }))
  })
}

const help = await run(["--help"])
assert.equal(help.code, 0)
assert.match(help.stdout, /Usage: cluster-ui/)

const invalid = await run(["postgres://"])
assert.equal(invalid.code, 2)
assert.match(invalid.stderr, /connection target/i)

const conflict = await run(["./cluster.db"], { CLUSTER_UI_CLUSTERS: "other=./other.db" })
assert.equal(conflict.code, 2)
assert.match(conflict.stderr, /CLUSTER_UI_CLUSTERS/)

const source = await readFile(cli, "utf8")
assert.match(source, /cwd: process\.cwd\(\)/)
assert.match(source, /CLUSTER_UI_DIST: dist/)
assert.match(source, /CLUSTER_UI_CLUSTERS = `default=\$\{target\}`/)
assert.match(source, /CLUSTER_UI_TARGET/)

console.log("CLI checks passed")
