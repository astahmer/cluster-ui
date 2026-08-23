/**
 * Boots the API router on an ephemeral port and exercises every endpoint.
 *   pnpm e2e
 */
import { HttpServer } from "@effect/platform"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"
import { api } from "../src/api.ts"

const PORT = 8791

const HttpLive = api.pipe(
  HttpServer.serve(),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: PORT, host: "127.0.0.1" }))
)

let failures = 0
async function check(name: string, path: string, expect: (body: any) => boolean) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  const text = await res.text()
  const body = name === "healthz" ? text : JSON.parse(text)
  const ok = res.status === 200 && body !== null && (name === "healthz" ? body === "ok" : expect(body))
  console.log(`${ok ? "✓" : "✗"} ${name} (${res.status})`)
  if (!ok) {
    failures++
    console.log("  ", JSON.stringify(body).slice(0, 200))
  }
  return body
}

async function run() {
  await check("healthz", "/healthz", () => true)
  const ov = await check("overview", "/api/overview", (b) =>
    typeof b.messages?.pending === "number" && typeof b.shards?.total === "number")
  await check("runners", "/api/runners", (b) => Array.isArray(b) && b.length > 0 && b[0].address)
  const shards = await check("shards", "/api/shards", (b) => Array.isArray(b) && b.length > 0)
  await check("entities", "/api/entities", (b) => Array.isArray(b) && b[0].entityType)
  const wfs = await check("workflows", "/api/workflows", (b) => Array.isArray(b))
  const msgs = await check("messages list", "/api/messages?pageSize=5", (b) => b.rows?.length === 5 && b.total > 0)
  await check("messages paging", "/api/messages?page=2&pageSize=5", (b) => b.page === 2 && b.rows.length <= 5)
  await check("messages filter done", "/api/messages?status=done", (b) => b.rows.every((r: any) => r.status === "done"))
  await check(
    "messages search",
    `/api/messages?q=${encodeURIComponent(msgs.rows[0].entityId.slice(0, 8))}`,
    (b) => b.total >= 1
  )
  await check("message detail", `/api/messages/${msgs.rows[0].id}`, (b) => b.message.id === msgs.rows[0].id)
  if (wfs.length > 0) {
    const wf = wfs.find((w: any) => w.runs > 0)!
    const runs = await check("workflow runs", `/api/workflows/${encodeURIComponent(wf.name)}`, (b) => b.length > 0)
    const run = runs.find((r: any) => r.executionId)!
    await check(
      "workflow run detail",
      `/api/workflows/${encodeURIComponent(wf.name)}/${encodeURIComponent(run.executionId)}`,
      (b) => b.run !== null && Array.isArray(b.activities)
    )
  }
  // unassigned shards exist in demo data
  if (!shards.some((s: any) => s.address === null)) {
    console.log("ℹ no unassigned shards in dataset (ok)")
  }
  void ov

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`)
  process.exitCode = failures === 0 ? 0 : 1
}

const program = Effect.scoped(
  Effect.flatMap(Layer.build(HttpLive), () =>
    Effect.promise(() => run()).pipe(
      Effect.andThen(Effect.sync(() => {
        process.exitCode = failures === 0 ? 0 : 1
      }))
    )
  )
)

NodeRuntime.runMain(program)
