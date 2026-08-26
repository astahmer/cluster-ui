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
import { parseClusters } from "../src/config.ts"
import { makeRedisRepo } from "../src/redis-repo.ts"
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
  const demo = spawn(process.execPath, [
    "--experimental-transform-types",
    "--no-warnings",
    "--import",
    resolve("server/scripts/register-ts-resolve.mjs"),
    resolve("server/scripts/demo-runner.ts")
  ], { stdio: "ignore" })
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
    Array.isArray(b.clusters) && b.clusters.length > 0 && "readonly" in b && ["viewer", "operator", "admin"].includes(b.role))
  await check("alerts list", "/api/alerts", (b) => Array.isArray(b))
  const badAlert = await fetch(`http://127.0.0.1:${PORT}/api/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "invalid", cluster: "default", metric: "failed", operator: "gte", threshold: 1, durationMs: 0, webhookUrl: "http://127.0.0.1" }) })
  const badAlertOk = badAlert.status === 400
  console.log(`${badAlertOk ? "✓" : "✗"} alert webhook validation`)
  if (!badAlertOk) failures++
  await check("audit list", "/api/audit?limit=5", (b) => Array.isArray(b))
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
  // /api/traces is offset-paged (P1-15): { rows: [...], total }
  const traces = await check("traces list", "/api/traces", (b) =>
    Array.isArray(b.rows) && b.rows.length > 0 && typeof b.rows[0].traceId === "string" && b.rows[0].count >= 1)
  const traceRows = await check("trace detail", `/api/traces/${encodeURIComponent(traces.rows[0].traceId)}`,
    (b) => Array.isArray(b.rows) && b.rows.length === traces.rows[0].count && b.rows.every((r: any) => r.traceId === traces.rows[0].traceId))
  // trace SSE must send an initial bounded snapshot without waiting for a second tick
  const traceStreamRes = await fetch(`http://127.0.0.1:${PORT}/api/traces/${encodeURIComponent(traces.rows[0].traceId)}/events`)
  const traceReader = traceStreamRes.body?.getReader()
  const firstChunk = traceReader ? await traceReader.read() : { done: true, value: undefined }
  const firstText = firstChunk.value ? new TextDecoder().decode(firstChunk.value) : ""
  const traceSseOk = traceStreamRes.status === 200 && firstText.includes("event: trace") && firstText.includes(traces.rows[0].traceId)
  console.log(`${traceSseOk ? "✓" : "✗"} trace SSE initial snapshot`)
  if (!traceSseOk) failures++
  await traceReader?.cancel()
  const rangeTraces = await check(
    "traces time range",
    `/api/traces?createdAfter=${traces.rows[0].firstAt}&createdBefore=${traces.rows[0].lastAt}`,
    (b) => Array.isArray(b.rows) && b.rows.length > 0
  )
  void rangeTraces
  const wfs = await check("workflows", "/api/workflows", (b) =>
    Array.isArray(b) && b.every((w: any) => "failedRuns" in w))
  const msgs = await check("messages list", "/api/messages?pageSize=5", (b) => b.rows?.length === 5 && b.total > 0)
  await check("messages paging", "/api/messages?page=2&pageSize=5", (b) => b.page === 2 && b.rows.length <= 5)
  const firstMessageAt = Number(msgs.rows[0]?.createdAt ?? 0)
  await check("messages time range", `/api/messages?createdAfter=${firstMessageAt}&createdBefore=${firstMessageAt}`, (b) => b.total >= 1 && b.rows.every((r: any) => r.createdAt === firstMessageAt))
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
      (b) => b.run !== null && Array.isArray(b.activities) && Array.isArray(b.eventHistory)
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

  // ---- MCP endpoint (stateless JSON-RPC) -------------------------------
  const mcpPost = async (payload: unknown) => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
    return { status: res.status, body: res.status === 202 ? null : await res.json() }
  }
  const init = await mcpPost({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  const initOk =
    init.status === 200 &&
    (init.body as any)?.result?.serverInfo?.name === "cluster-ui" &&
    typeof (init.body as any)?.result?.protocolVersion === "string"
  console.log(`${initOk ? "✓" : "✗"} mcp initialize`)
  if (!initOk) failures++

  const toolsList = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  const toolNames = ((toolsList.body as any)?.result?.tools ?? []).map((t: any) => t.name)
  const listOk =
    toolsList.status === 200 && toolNames.includes("retry_message") && toolNames.includes("query_messages")
  console.log(`${listOk ? "✓" : "✗"} mcp tools/list (${toolNames.length} tools)`)
  if (!listOk) failures++

  const qCall = await mcpPost({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "query_messages", arguments: { pageSize: 1 } }
  })
  let qOk = qCall.status === 200 && (qCall.body as any)?.result?.isError === false
  if (qOk) {
    try {
      const parsed = JSON.parse((qCall.body as any).result.content[0].text)
      qOk = Array.isArray(parsed.rows) && parsed.rows.length <= 1
    } catch {
      qOk = false
    }
  }
  console.log(`${qOk ? "✓" : "✗"} mcp tools/call query_messages`)
  if (!qOk) failures++

  const badCall = await mcpPost({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "retry_message", arguments: { id: "42" } }
  })
  const badOk = badCall.status === 200 && (badCall.body as any)?.result?.isError === true
  console.log(`${badOk ? "✓" : "✗"} mcp unknown-id write -> isError`)
  if (!badOk) failures++

  // ---- agent stream route (no key -> clean 401) ------------------------
  const noKey = await fetch(`http://127.0.0.1:${PORT}/api/agent/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] })
  })
  const noKeyOk = noKey.status === 401
  console.log(`${noKeyOk ? "✓" : "✗"} agent stream without key -> 401`)
  if (!noKeyOk) failures++

  // ---- redis-only routes degrade cleanly on sqlite clusters -------------
  const redisOnlyRoutes: Array<[string, unknown]> = [
    ["/api/actions/pause-queue", { queue: "mail" }],
    ["/api/actions/promote", { id: "mail:1" }],
    ["/api/actions/clean", { queue: "*", state: "completed" }],
    ["/api/actions/add-job", { queue: "mail", name: "manual", data: { hello: true } }]
  ]
  let redisRoutesOk = true
  for (const [route, payload] of redisOnlyRoutes) {
    const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
    const body = (await res.json()) as any
    const ok = res.status === 400 && body.error === "not supported for this cluster type"
    if (!ok) {
      redisRoutesOk = false
      console.log("   ", route, res.status, JSON.stringify(body).slice(0, 120))
    }
  }
  console.log(`${redisRoutesOk ? "✓" : "✗"} redis-only action routes -> clean 400 on sqlite`)
  if (!redisRoutesOk) failures++

  const queuesRes = await fetch(`http://127.0.0.1:${PORT}/api/queues`)
  const queuesBody = (await queuesRes.json()) as any
  const queuesOk = queuesRes.status === 200 && Array.isArray(queuesBody) && queuesBody.length === 0
  console.log(`${queuesOk ? "✓" : "✗"} GET /api/queues -> [] on sqlite`)
  if (!queuesOk) failures++

  const treeRes = await fetch(`http://127.0.0.1:${PORT}/api/job-tree/mail%3A1`)
  const treeBody = (await treeRes.json()) as any
  const treeOk = treeRes.status === 400 && treeBody.error === "not supported for this cluster type"
  console.log(`${treeOk ? "✓" : "✗"} GET /api/job-tree -> clean 400 on sqlite`)
  if (!treeOk) failures++

  // ---- redis config parsing + unreachable-redis degradation ------------
  const parsed = parseClusters("demo=redis://localhost:6399,default=./data/cluster.db:cluster")
  const parseOk =
    parsed.length === 2 &&
    parsed[0].kind === "redis" &&
    parsed[0].url === "redis://localhost:6399" &&
    parsed[1].kind === "sqlite" &&
    parsed[1].dbFile === "./data/cluster.db" &&
    parsed[1].prefix === "cluster"
  console.log(`${parseOk ? "✓" : "✗"} redis/sqlite cluster parsing`)
  if (!parseOk) failures++

  const deadRedisStarted = Date.now()
  try {
    const overview = await makeRedisRepo("redis://127.0.0.1:6399").overview()
    const degradedOk = Date.now() - deadRedisStarted < 10_000
    console.log(`${degradedOk ? "✓" : "✗"} unreachable redis degrades (no hang, ${Date.now() - deadRedisStarted}ms)`)
    if (!degradedOk) failures++
    void overview
  } catch (e) {
    const elapsed = Date.now() - deadRedisStarted
    const clean = elapsed < 10_000
    console.log(`${clean ? "✓" : "✗"} unreachable redis fails fast (${elapsed}ms: ${String(e).slice(0, 60)})`)
    if (!clean) failures++
  }

  // unknown cluster
  const badCluster = await fetch(`http://127.0.0.1:${PORT}/api/overview?cluster=nope`)
  const badClusterOk = badCluster.status === 404
  console.log(`${badClusterOk ? "✓" : "✗"} unknown cluster -> 404`)
  if (!badClusterOk) failures++
  void cfg; void shards; void ov

  // ---- auth flow (separate server with CLUSTER_UI_TOKEN) ----------------
  const { spawn } = await import("node:child_process")
  const AUTH_PORT = PORT + 1
  const child = spawn("node", ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/register-ts-resolve.mjs", "server/src/main.ts"], {
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
    const roleBody = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/config`, {
      headers: { authorization: "Bearer secret-token" }
    }).then((r) => r.json())
    const authOk = noTok.status === 401 && badTok.status === 401 && goodTok.status === 200 && roleBody.role === "operator"
    console.log(`${authOk ? "✓" : "✗"} token auth (401/401/200)`)
    if (!authOk) failures++

    const staticOk = await fetch(`http://127.0.0.1:${AUTH_PORT}/`).then((r) => r.status)
    const staticFree = staticOk !== 401
    console.log(`${staticFree ? "✓" : "✗"} static assets exempt from auth`)
    if (!staticFree) failures++
  } finally {
    child.kill("SIGKILL")
  }

  // ---- redis integration (spawns its own redis + demo seed) -------------
  const { execFileSync } = await import("node:child_process")
  let redisProc: ChildProcess | null = null
  const hasRedis = await new Promise<boolean>((resolveHas) => {
    try {
      execFileSync("which", ["redis-server"], { stdio: "ignore" })
      resolveHas(true)
    } catch {
      resolveHas(false)
    }
  })
  if (!hasRedis) {
    console.log("- redis-server not on PATH — skipping redis integration section")
  } else {
    const REDIS_PORT = 6399
    redisProc = spawn("redis-server", ["--port", String(REDIS_PORT), "--daemonize", "no", "--save", ""], {
      stdio: "ignore"
    })
    await new Promise((r) => setTimeout(r, 800))
    try {
      const REDIS_PORT_STR = String(REDIS_PORT)
      const seedOut = execFileSync("node", ["scripts/demo-redis.mjs"], {
        cwd: resolve(import.meta.dirname, "../.."),
        encoding: "utf8",
        timeout: 20_000
      })
      const rootMatch = seedOut.match(/flow root: bull:([a-z]+):(\d+)/)
      const ROOT_ID = rootMatch ? `${rootMatch[1]}:${rootMatch[2]}` : null

      const R_PORT = PORT + 2
      const envClusters = `default=${resolve(import.meta.dirname, "../../data/cluster.db")},local-redis=redis://127.0.0.1:${REDIS_PORT}`
      const rchild = spawn("node",
        ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/register-ts-resolve.mjs", "server/src/main.ts"],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          env: { ...process.env, PORT: String(R_PORT), CLUSTER_UI_CLUSTERS: envClusters },
          stdio: "ignore"
        }
      )
      try {
        let rup = false
        for (let i = 0; i < 40 && !rup; i++) {
          await new Promise((r2) => setTimeout(r2, 250))
          rup = await fetch(`http://127.0.0.1:${R_PORT}/healthz`).then((r2) => r2.ok).catch(() => false)
        }

        const rc = async (name: string, path: string, expect: (body: any) => boolean) => {
          const res = await fetch(`http://127.0.0.1:${R_PORT}${path}`)
          const body = await res.json().catch(() => null)
          const ok = res.status === 200 && body !== null && expect(body)
          console.log(`${ok ? "✓" : "✗"} ${name} (${res.status})`)
          if (!ok) {
            failures++
            console.log("  ", JSON.stringify(body).slice(0, 200))
          }
          return body
        }

        await rc("redis overview counts", "/api/overview?cluster=local-redis", (b) =>
          b.messages.failed === 8 && b.messages.done > 0 && b.messages.pending > 0)

        const sched = await rc("redis scheduled rows are arrays", "/api/messages?cluster=local-redis&status=scheduled&pageSize=3",
          (b) => Array.isArray(b.rows))
        void sched

        const firstDone = await rc("redis done rows", "/api/messages?cluster=local-redis&status=done&pageSize=1",
          (b) => Array.isArray(b.rows) && b.rows.length === 1)
        const detailId = firstDone?.rows?.[0]?.id
        if (detailId) {
          const dres = await fetch(`http://127.0.0.1:${R_PORT}/api/messages/${encodeURIComponent(detailId)}?cluster=local-redis`)
          const detail = await dres.json().catch(() => null)
          const dOk = dres.status === 200 && typeof detail?.message?.status === "string"
          console.log(`${dOk ? "✓" : "✗"} redis message detail envelope (.message present)`)
          if (!dOk) failures++
        }

        // THE regression: entity instances must be an object with rows array
        await rc("redis entity instances (regression)", "/api/entity-instances?cluster=local-redis&entityType=emails",
          (b) => Array.isArray(b.rows) && typeof b.total === "number")

        const queuesBody = await rc("redis queues listing", "/api/queues?cluster=local-redis",
          (b) => Array.isArray(b) && b.some((q: any) => q.name === "webhooks" && q.paused === true))

        const queueJobs = await rc("redis queue jobs browser", "/api/queues/emails/jobs?cluster=local-redis&state=completed&limit=2&offset=0",
          (b) => b.queue === "emails" && b.state === "completed" && Array.isArray(b.rows) && b.rows.length <= 2 && typeof b.total === "number" && b.rows[0]?.data !== undefined)
        if (queueJobs?.rows?.[0]?.id) {
          const jobDetailRes = await fetch(`http://127.0.0.1:${R_PORT}/api/queue-jobs/${encodeURIComponent(queueJobs.rows[0].id)}?cluster=local-redis`)
          const jobDetail = await jobDetailRes.json().catch(() => null)
          const jobDetailOk = jobDetailRes.status === 200 && jobDetail.id === queueJobs.rows[0].id && jobDetail.state === "completed" && "attemptsMade" in jobDetail
          console.log(`${jobDetailOk ? "✓" : "✗"} redis queue job detail`)
          if (!jobDetailOk) failures++
        }

        // pause/resume round trip on a non-paused queue
        await fetch(`http://127.0.0.1:${R_PORT}/api/actions/pause-queue`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ queue: "payments", cluster: "local-redis" })
        })
        const afterPause = await fetch(`http://127.0.0.1:${R_PORT}/api/queues?cluster=local-redis`).then((r2) => r2.json())
        const pausedOk = afterPause.some((q: any) => q.name === "payments" && q.paused === true)
        await fetch(`http://127.0.0.1:${R_PORT}/api/actions/resume-queue`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ queue: "payments", cluster: "local-redis" })
        })
        const afterResume = await fetch(`http://127.0.0.1:${R_PORT}/api/queues?cluster=local-redis`).then((r2) => r2.json())
        const resumedOk = afterResume.every((q: any) => !(q.name === "payments" && q.paused))
        console.log(`${pausedOk && resumedOk ? "✓" : "✗"} queue pause/resume round trip`)
        if (!(pausedOk && resumedOk)) failures++
        void queuesBody

        // job tree: flow parent -> 3 cross-queue children
        if (ROOT_ID) {
          const treeRes = await fetch(`http://127.0.0.1:${R_PORT}/api/job-tree/${encodeURIComponent(ROOT_ID)}?cluster=local-redis`)
          const tree = await treeRes.json().catch(() => null)
          const treeOk = treeRes.status === 200 && Array.isArray(tree?.children) && tree.children.length === 3
          console.log(`${treeOk ? "✓" : "✗"} job-tree resolves flow parent w/ 3 children`)
          if (!treeOk) failures++
        } else {
          failures++
          console.log("✗ could not parse flow root from seeder output")
        }

        // add-job -> shows up as pending; clean removes completed by count
        const addRes = await fetch(`http://127.0.0.1:${R_PORT}/api/actions/add-job`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ queue: "emails", name: "dash-test", data: { source: "e2e" }, cluster: "local-redis" })
        })
        const added = await addRes.json().catch(() => null)
        const addOk = addRes.status === 200 && typeof added?.id === "string"
        console.log(`${addOk ? "✓" : "✗"} add-job returns generated id`)
        if (!addOk) failures++

        const cleanRes = await fetch(`http://127.0.0.1:${R_PORT}/api/actions/clean`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ queue: "*", state: "completed", count: 5, cluster: "local-redis" })
        })
        const cleaned = await cleanRes.json().catch(() => null)
        const cleanOk = cleanRes.status === 200 && typeof cleaned?.removed === "number" && cleaned.removed >= 1
        console.log(`${cleanOk ? "✓" : "✗"} clean completed by count (removed ${cleaned?.removed ?? "?"})`)
        if (!cleanOk) failures++

        // promote: delay one job then promote it back to wait
        // (covered indirectly by add/pause flows above; direct promote needs a delayed id —
        //  fetch one from scheduled view)
        const delayedRows = await fetch(`http://127.0.0.1:${R_PORT}/api/messages?cluster=local-redis&status=scheduled&pageSize=1`).then((r2) => r2.json())
        if (delayedRows?.rows?.length === 1) {
          await fetch(`http://127.0.0.1:${R_PORT}/api/actions/promote`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: delayedRows.rows[0].id, cluster: "local-redis" })
          })
          const afterPromote = await fetch(`http://127.0.0.1:${R_PORT}/api/messages?cluster=local-redis&entityId=${delayedRows.rows[0].entityId}&pageSize=5`).then((r2) => r2.json())
          const promotedOk = Array.isArray(afterPromote.rows) && afterPromote.rows.some((r2: any) => r2.status === "pending")
          console.log(`${promotedOk ? "✓" : "✗"} promote delayed -> pending`)
          if (!promotedOk) failures++
        }
      } finally {
        rchild.kill("SIGKILL")
      }
    } finally {
      try {
        execFileSync("redis-cli", ["-p", String(REDIS_PORT), "shutdown", "nosave"], { stdio: "ignore" })
      } catch {}
      redisProc.kill("SIGKILL")
    }
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
