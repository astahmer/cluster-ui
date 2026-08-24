/**
 * Boots the API router on an ephemeral port and exercises every endpoint.
 *   pnpm e2e
 */
import { HttpServer } from "@effect/platform"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"
import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"
import { api, clusterRepos } from "../src/api.ts"
import * as metrics from "../src/metrics.ts"

const PORT = 8791

const HttpLive = api.pipe(
  HttpServer.serve(),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: PORT, host: "127.0.0.1" })),
  Layer.provide(metrics.samplerLayer(clusterRepos))
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
  // demo reporter for the 127.0.0.1:9199 seeded runner
  const demo = spawn("npx", ["tsx", resolve("server/scripts/demo-runner.ts")], { stdio: "ignore" })
  try {
    // wait for the demo reporter to accept connections (best effort)
    for (let i = 0; i < 20; i++) {
      const up = await fetch("http://127.0.0.1:9199/internal/cluster-ui/state").then((r) => r.ok).catch(() => false)
      if (up) break
      await new Promise((r) => setTimeout(r, 250))
    }
    await runChecks()
  } finally {
    demo.kill("SIGKILL")
  }
}

async function runChecks() {
  await check("healthz", "/healthz", () => true)
  const cfg = await check("config", "/api/config", (b) =>
    Array.isArray(b.clusters) && b.clusters.length > 0 && "readonly" in b)
  await check("clusters", "/api/clusters", (b) => Array.isArray(b) && b[0].name)
  const ov = await check("overview", "/api/overview", (b) =>
    typeof b.messages?.pending === "number" && typeof b.messages?.failed === "number" &&
    typeof b.unassignedShards === "number")
  const runners = await check("runners", "/api/runners", (b) =>
    Array.isArray(b) && b.length > 0 && "stale" in b[0] && b.some((r: any) => r.stale))
  void runners
  const shards = await check("shards", "/api/shards", (b) => Array.isArray(b) && b.length > 0)
  await check("entities", "/api/entities", (b) => Array.isArray(b) && b[0].entityType)
  await check("entity-instances", `/api/entity-instances?entityType=${encodeURIComponent("Counter")}`, (b) =>
    Array.isArray(b.rows) && b.rows.length > 0 && b.rows[0].entityId && "failed" in b.rows[0])
  await check("crons", "/api/crons", (b) =>
    Array.isArray(b) && b.length >= 2 && b.every((c: any) => c.name.startsWith("ClusterCron/") || typeof c.nextRunAt === "number"))
  await check("singletons", "/api/singletons", (b) =>
    Array.isArray(b.runners) && b.runners.length > 0 &&
    // demo reporter answers with 3 singletons on 127.0.0.1:9199
    b.runners.some((r: any) => r.state?.singletons?.length === 3) &&
    // unreachable runners degrade to error entries instead of failing the request
    b.runners.some((r: any) => !r.state && typeof r.error === "string"))
  await new Promise((r) => setTimeout(r, 300)) // let the sampler take its first sample
  await check("metrics history", "/api/metrics/history", (b) =>
    Array.isArray(b) && b.length > 0 && "failed" in b[0] && "unassignedShards" in b[0])
  await check("metrics history rangeMs", "/api/metrics/history?rangeMs=60000", (b) =>
    Array.isArray(b) && b.every((s: any) => Date.now() - s.t <= 120_000))

  // ---- traces ----------------------------------------------------------
  const traces = await check("traces list", "/api/traces", (b) =>
    Array.isArray(b) && b.length > 0 && typeof b[0].traceId === "string" && b[0].count >= 1)
  const traceRows = await check("trace detail", `/api/traces/${encodeURIComponent(traces[0].traceId)}`,
    (b) => Array.isArray(b.rows) && b.rows.length === traces[0].count && b.rows.every((r: any) => r.traceId === traces[0].traceId))
  void traceRows
  const wfs = await check("workflows", "/api/workflows", (b) =>
    Array.isArray(b) && b.every((w: any) => "failedRuns" in w))
  const msgs = await check("messages list", "/api/messages?pageSize=5", (b) => b.rows?.length === 5 && b.total > 0)
  await check("messages paging", "/api/messages?page=2&pageSize=5", (b) => b.page === 2 && b.rows.length <= 5)
  await check("messages filter done", "/api/messages?status=done", (b) => b.rows.every((r: any) => r.status === "done"))
  const failedList = await check("messages filter failed", "/api/messages?failed=true&pageSize=5", (b) =>
    b.total >= 1 && b.rows.every((r: any) => r.failed === true))
  await check(
    "messages search",
    `/api/messages?q=${encodeURIComponent(msgs.rows[0].entityId.slice(0, 8))}`,
    (b) => b.total >= 1
  )
  await check("messages entityId filter", `/api/messages?entityType=${encodeURIComponent(failedList.rows[0].entityType)}&entityId=${encodeURIComponent(failedList.rows[0].entityId)}`, (b) =>
    b.total >= 1 && b.rows.every((r: any) => r.entityId === failedList.rows[0].entityId))
  const detail = await check("message detail (failure result)", `/api/messages/${failedList.rows[0].id}`, (b) => {
    if (b.message.id !== failedList.rows[0].id) return false
    return b.result?.outcome === "Failure" &&
      b.replies.some((r: any) => r.kind === "withExit" && r.payload?._tag === "Failure")
  })
  void detail
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

  // ---- actions ----------------------------------------------------------
  const doneRow = (await check("actions target", "/api/messages?status=done&pageSize=1", (b) => b.rows.length === 1)).rows[0]
  const retryRes = await fetch(`http://127.0.0.1:${PORT}/api/actions/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: doneRow.id })
  })
  const retried = await retryRes.json()
  const afterRetry = await fetch(`http://127.0.0.1:${PORT}/api/messages/${doneRow.id}`).then((r) => r.json())
  const retryOk =
    retryRes.status === 200 && retried.ok === true &&
    afterRetry.message.processed === false && afterRetry.replies.every((r: any) => r.kind !== "withExit")
  console.log(`${retryOk ? "✓" : "✗"} action retry (row now pending, exit reply dropped)`)
  if (!retryOk) failures++

  const pendingCandidates = (await check("interrupt target", "/api/messages?status=pending&pageSize=50", (b) => b.rows.length >= 1)).rows
  const pendingRow = pendingCandidates.find((r: any) => r.kind === "request") ?? pendingCandidates[0]
  const intRes = await fetch(`http://127.0.0.1:${PORT}/api/actions/interrupt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: pendingRow.id })
  })
  const interruptOk = intRes.status === 200 && (await intRes.json()).ok === true
  console.log(`${interruptOk ? "✓" : "✗"} action interrupt`)
  if (!interruptOk) failures++

  const missingAction = await fetch(`http://127.0.0.1:${PORT}/api/actions/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: "1" })
  })
  const missingOk = missingAction.status === 404
  console.log(`${missingOk ? "✓" : "✗"} action on unknown id -> 404`)
  if (!missingOk) failures++

  // ---- bulk + delete + /metrics ----------------------------------------
  const pending = await (async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/messages?status=scheduled&pageSize=3`)
    return ((await res.json()) as any).rows as Array<{ id: string }>
  })()
  const bulkIds = pending.slice(0, 2).map((r) => r.id)
  if (bulkIds.length === 2) {
    const bulkRes = await fetch(`http://127.0.0.1:${PORT}/api/actions/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [...bulkIds, "42"], action: "interrupt" })
    })
    const bulkBody = (await bulkRes.json()) as any
    const bulkOk = bulkRes.status === 200 &&
      bulkBody.results.length === 3 &&
      bulkBody.results.filter((r: any) => r.ok).length === 2 &&
      bulkBody.results.some((r: any) => !r.ok && r.status === 404)
    console.log(`${bulkOk ? "✓" : "✗"} bulk interrupt (2 ok, 1 per-id 404)`)
    if (!bulkOk) failures++
  }

  const delTarget = await (async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/messages?status=pending&pageSize=1`)
    return ((await res.json()) as any).rows[0] as { id: string }
  })()
  if (delTarget) {
    await fetch(`http://127.0.0.1:${PORT}/api/actions/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: delTarget.id })
    })
    const after = await fetch(`http://127.0.0.1:${PORT}/api/messages/${delTarget.id}`)
    const delOk = after.status === 404
    console.log(`${delOk ? "✓" : "✗"} delete message (gone afterwards)`)
    if (!delOk) failures++
  }

  const prom = await fetch(`http://127.0.0.1:${PORT}/metrics`)
  const promText = await prom.text()
  const promOk = prom.ok && promText.includes("cluster_ui_messages") && promText.includes("cluster_ui_runners")
  console.log(`${promOk ? "✓" : "✗"} prometheus /metrics exposition`)
  if (!promOk) failures++

  // unknown cluster
  const badCluster = await fetch(`http://127.0.0.1:${PORT}/api/overview?cluster=nope`)
  const badClusterOk = badCluster.status === 404
  console.log(`${badClusterOk ? "✓" : "✗"} unknown cluster -> 404`)
  if (!badClusterOk) failures++
  void cfg; void shards; void ov

  // ---- auth flow (separate server with CLUSTER_UI_TOKEN) ----------------
  const { spawn } = await import("node:child_process")
  const AUTH_PORT = PORT + 1
  const child = spawn("npx", ["tsx", "server/src/main.ts"], {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, PORT: String(AUTH_PORT), CLUSTER_UI_TOKEN: "secret-token" },
    stdio: "ignore"
  })
  try {
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 250))
      up = await fetch(`http://127.0.0.1:${AUTH_PORT}/healthz`).then((r) => r.ok).catch(() => false)
    }
    const noTok = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/overview`)
    const badTok = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/overview`, {
      headers: { authorization: "Bearer wrong" }
    })
    const goodTok = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/overview`, {
      headers: { authorization: "Bearer secret-token" }
    })
    const authOk = noTok.status === 401 && badTok.status === 401 && goodTok.status === 200
    console.log(`${authOk ? "✓" : "✗"} token auth (401/401/200)`)
    if (!authOk) failures++

    const staticOk = await fetch(`http://127.0.0.1:${AUTH_PORT}/`).then((r) => r.status)
    const staticFree = staticOk !== 401
    console.log(`${staticFree ? "✓" : "✗"} static assets exempt from auth`)
    if (!staticFree) failures++
  } finally {
    child.kill("SIGKILL")
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`)
  // the metrics daemon fiber keeps the runtime alive — exit explicitly
  process.exit(failures === 0 ? 0 : 1)
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
