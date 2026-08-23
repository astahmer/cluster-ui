/**
 * Headless smoke test: boots the built frontend bundle in jsdom with a mocked
 * fetch layer and asserts the app renders real data.
 *   node web/smoke.mjs   (run `vite build` first)
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"

const root = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(root, "../dist/index.html"), "utf8")
const js = readFileSync(
  resolve(root, "../dist", html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1] ?? ""),
  "utf8"
)

const overview = {
  messages: { pending: 29, inflight: 1, scheduled: 3, done: 118 },
  runners: { total: 3 },
  shards: { total: 256, assigned: 236 },
  topEntities: [{ entityType: "Session", total: 48, active: 8 }],
  topWorkflows: [{ name: "OnboardingWorkflow", runs: 6 }],
  serverTime: Date.now()
}
const runner = {
  address: "10.0.4.11:8080",
  host: "10.0.4.11",
  port: 8080,
  groups: ["api"],
  version: 2,
  shards: 79
}
const message = {
  id: "123456789012345678",
  messageId: null,
  shardId: "42",
  entityType: "Counter",
  entityId: "counter-1",
  kind: "request",
  tag: "Increment",
  traceId: null,
  processed: false,
  status: "pending",
  lastRead: null,
  deliverAt: null,
  createdAt: Date.now() - 60_000,
  machineId: 7,
  replyCount: 0
}

const routes = {
  "/api/config": { clusters: ["default"], tracingUrlTemplate: null, readonly: false },
  "/api/clusters": [{ name: "default" }],
  "/api/metrics/history": Array.from({ length: 20 }, (_, i) => ({
    t: Date.now() - (20 - i) * 10_000,
    pending: 20 + i,
    inflight: 2,
    scheduled: 3,
    done: 100 + i,
    failed: i % 5,
    unassignedShards: i < 10 ? 12 : 0
  })),
  "/api/crons": [
    { name: "ClusterCron/NightlyCleanup", entityType: "ClusterCron/NightlyCleanup", lastRunAt: Date.now() - 3600_000, nextRunAt: Date.now() + 3600_000, lastStatus: "done", overdue: false }
  ],
  "/api/entity-instances": [
    { entityId: "counter-1", total: 3, pending: 1, inflight: 0, scheduled: 0, done: 2, failed: 0, lastActivityAt: Date.now() }
  ],
  "/api/overview": overview,
  "/api/runners": [runner],
  "/api/shards": Array.from({ length: 16 }, (_, i) => ({
    shardId: String(i),
    address: i % 13 === 5 ? null : runner.address
  })),
  "/api/entities": [
    {
      entityType: "Counter",
      entities: 24,
      messages: 37,
      done: 24,
      scheduled: 3,
      inflight: 1,
      pending: 9,
      lastActivityAt: Date.now()
    }
  ],
  "/api/workflows": [
    { name: "OnboardingWorkflow", runs: 6, completedRuns: 4, activeRuns: 2, lastActivityAt: Date.now() }
  ],
  "/api/messages": { rows: [message], total: 150, page: 1, pageSize: 50 },
  "/healthz": "ok"
}

import { VirtualConsole } from "jsdom"
const vc = new VirtualConsole()
vc.on("error", (...a) => console.log("[console.error]", ...a))
vc.on("warn", () => {})
vc.on("jsdomError", (e) => console.log("[jsdomError]", e.message, (e.detail?.stack || "").slice(0, 400)))
const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/, ""), {
  url: "http://localhost/#/overview",
  pretendToBeVisual: true,
  runScripts: "outside-only",
  virtualConsole: vc
})
const { window } = dom
window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
window.addEventListener("error", (e) => {
  console.log("[window.error]", e.message, (e.error?.stack || "").slice(0, 500))
})
window.addEventListener("unhandledrejection", (e) => {
  console.log("[unhandledrejection]", String(e.reason).slice(0, 300))
})
window.EventSource = class {
  constructor() {
    setTimeout(() => this.onerror?.(new Event("error")), 0)
  }
  close() {}
}
window.__fetched = []
window.fetch = (url) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "")
  const base = path.split("?")[0]
  window.__fetched.push(base + path.slice(base.length))
  const body = JSON.stringify(routes[base] ?? {})
  return Promise.resolve(new window.Response(body, { status: 200 }))
}
// minimal Response polyfill via jsdom window
if (!window.Response) {
  window.Response = class Response {
    #body
    constructor(body) {
      this.#body = body
    }
    get ok() {
      return true
    }
    json() {
      return Promise.resolve(JSON.parse(this.#body))
    }
  }
}

let failures = 0
function assert(name, cond) {
  console.log(`${cond ? "✓" : "✗"} ${name}`)
  if (!cond) failures++
}

await new Promise((r) => setTimeout(r, 50))
try {
  window.eval(js)
} catch (e) {
  console.log("[eval error]", e?.stack?.slice(0, 600))
}

// wait for effects + polling fetch to paint the DOM
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (
    window.document.body.textContent.includes("Pending") &&
    window.document.body.textContent.includes("29")
  )
    break
}

const text = window.document.body.textContent
assert("app booted (sidebar)", text.includes("cluster-ui") && text.includes("Overview"))
assert("overview stats rendered", text.includes("Pending") && text.includes("In-flight"))
assert("shard summary rendered", text.includes("236") && text.includes("256"))
assert("failed stat card", text.includes("exited with Failure"))
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (window.document.querySelectorAll("svg").length > 0) break
}
assert("sparklines rendered", window.document.querySelectorAll("svg").length >= 4)
assert("unassigned banner", text.includes("unassigned") || window.document.body.textContent.includes("unassigned"))

// navigate to messages page
window.location.hash = "#/messages"
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (window.document.body.textContent.includes("counter-1")) break
}
const mtext = () => window.document.body.textContent
assert("messages page renders rows", mtext().includes("counter-1"))
assert("status badge rendered", mtext().includes("pending"))
assert("failed tab present", mtext().includes("Failed"))

// navigate to crons page
window.location.hash = "#/crons"
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 100))
  if (window.document.body.textContent.includes("NightlyCleanup")) break
}
assert("crons page renders jobs", window.document.body.textContent.includes("NightlyCleanup"))

console.log(failures === 0 ? "\nSMOKE PASS" : `\n${failures} SMOKE FAILURES`)
process.exit(failures === 0 ? 0 : 1)
