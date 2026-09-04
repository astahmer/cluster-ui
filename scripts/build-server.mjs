#!/usr/bin/env node
import { build } from "esbuild"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

await mkdir("server/dist", { recursive: true })
await build({
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
  ]
})
