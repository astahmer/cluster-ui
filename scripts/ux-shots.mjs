/**
 * Full-page screenshot capture for UX review — both clusters, desktop + mobile
 * widths, plus open-panel states. Output: /tmp/cu2-shots/<name>.png
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VITRINE_MODULES = "/Users/astahmer/dev/vitrine-app/node_modules"
const { chromium } = await import(`${VITRINE_MODULES}/playwright-core/index.mjs`)

const PORT = 8810
const REDIS_PORT = 6399
const OUT = "/tmp/cu2-shots"
mkdirSync(OUT, { recursive: true })

const DIST = resolve(ROOT, "dist")
if (!existsSync(DIST)) {
  console.error("dist/ missing — run pnpm build first")
  process.exit(1)
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }
const staticServer = createServer((req, res) => {
  let p = req.url.split("?")[0]
  let file = resolve(DIST, p === "/" ? "index.html" : `.${p}`)
  if (!file.startsWith(DIST) || !existsSync(file)) file = `${DIST}/index.html`
  res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" })
  res.end(readFileSync(file))
})
await new Promise((r) => staticServer.listen(PORT, r))

let redisProc = null
try {
  execFileSync("which", ["redis-server"], { stdio: "ignore" })
  redisProc = spawn("redis-server", ["--port", String(REDIS_PORT), "--daemonize", "no", "--save", ""], { stdio: "ignore" })
  await new Promise((r) => setTimeout(r, 700))
  execFileSync("node", ["scripts/demo-redis.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 20_000 })
} catch {}
const clusters = `default=${resolve(ROOT, "data/cluster.db")},local-redis=redis://127.0.0.1:${REDIS_PORT}`
const apiPort = PORT + 1
const apiProc = spawn(process.execPath, ["server/dist/main.cjs"],
  { cwd: ROOT, env: { ...process.env, PORT: String(apiPort), CLUSTER_UI_DIST: DIST, CLUSTER_UI_CLUSTERS: clusters }, stdio: "ignore" }
)
let apiUp = false
for (let i = 0; i < 40 && !apiUp; i++) {
  await new Promise((r) => setTimeout(r, 250))
  apiUp = await fetch(`http://127.0.0.1:${apiPort}/healthz`).then((r) => r.ok).catch(() => false)
}
if (!apiUp) { console.error("api failed to boot"); process.exit(1) }

// same-origin /api passthrough
staticServer.on("request", () => {})
const browser = await chromium.launch({ headless: true })

const PAGES = [
  ["/overview", "overview"],
  ["/runners", "runners"],
  ["/shards", "shards"],
  ["/entities", "entities"],
  ["/workflows", "workflows"],
  ["/crons", "crons"],
  ["/traces", "traces"],
  ["/queues", "queues"],
  ["/singletons", "runtime"],
  ["/messages", "messages"],
  ["/agent", "agent"],
  ["/mcp", "mcp"]
]

async function shoot(label, clusterParam) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (clusterParam) await context.addInitScript((c) => localStorage.setItem("cluster_ui_cluster", c), clusterParam)
  // /api passthrough via route interception
  await context.route("**/api/**", async (route) => {
    try {
      const req = route.request()
      const res = await fetch(`http://127.0.0.1:${apiPort}${req.url().replace(/^https?:\/\/[^/]+/, "")}`, {
        headers: req.headers(),
        method: req.method(),
        body: ["POST", "PUT"].includes(req.method()) ? req.postData() : undefined
      })
      await route.fulfill({ status: res.status, contentType: res.headers.get("content-type") ?? "application/json", body: await res.text() })
    } catch { await route.abort() }
  })
  const page = await context.newPage()
  const goto = async (hash, waitMs = 2200) => {
    await page.goto(`http://localhost:${PORT}/#${hash}`, { waitUntil: "domcontentloaded" }).catch(() => {})
    await page.waitForTimeout(Math.min(waitMs, 1400))
  }

  for (const [hash, name] of PAGES) {
    errors: await goto(hash)
    await page.screenshot({ path: `${OUT}/${name}-${label}.png` })
  }

  // panel-open states (desktop)
  await goto("/traces", 2000)
  const cascadeRow = page.locator("table tbody tr", { hasText: "ApiGateway" }).first()
  if ((await cascadeRow.count()) > 0 || (await page.locator("table tbody tr").count()) > 0) {
    await (await cascadeRow.count() > 0 ? cascadeRow : page.locator("table tbody tr").first()).click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/trace-panel-${label}.png` })
    await page.keyboard.press("Escape")
  }
  await goto("/messages", 1800)
  const row = page.locator("table tbody tr").first()
  if ((await row.count()) > 0) {
    await row.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/message-detail-${label}.png` })
    await page.keyboard.press("Escape")
  }
  await goto("/workflows", 1500)
  const wfLink = page.locator('a[href^="#/workflows/"]').first()
  if ((await wfLink.count()) > 0) {
    await wfLink.click(); await page.waitForTimeout(1400)
    const runRow = page.locator("table tbody tr").first()
    if ((await runRow.count()) > 0) {
      await runRow.click(); await page.waitForTimeout(1200)
      await page.screenshot({ path: `${OUT}/workflow-run-${label}.png` })
    }
  }
  await goto("/queues", 1500)
  const cleanBtn = page.locator('button:has-text("Clean")').first()
  if ((await cleanBtn.count()) > 0) { await cleanBtn.click(); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/clean-dialog-${label}.png` }) }
  // palette open
  await page.keyboard.press("Meta+k"); await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/palette-${label}.png` })

  // mobile width pass
  const mob = await context.newPage()
  await mob.setViewportSize({ width: 390, height: 844 })
  for (const [hash, name] of [["/overview", "overview"], ["/messages", "messages"], ["/workflows", "workflows"]]) {
    await mob.goto(`http://localhost:${PORT}/#${hash}`, { waitUntil: "domcontentloaded" }).catch(() => {})
    await mob.waitForTimeout(1600)
    await mob.screenshot({ path: `${OUT}/m-${name}-${label}.png` })
  }
  // mobile drawer
  const menuBtn = mob.locator('button[aria-label="open navigation menu"]').first()
  if (await menuBtn.count() > 0) { await menuBtn.click(); await mob.waitForTimeout(500); await mob.screenshot({ path: `${OUT}/m-drawer-${label}.png` }) }
  await context.close()
}

try {
  await shoot("sqlite", null)
  if (redisProc) await shoot("redis", "local-redis")
  console.log("SHOTS DONE")
} finally {
  await browser.close()
  apiProc?.kill("SIGKILL")
  redisProc?.kill("SIGKILL")
  try { execFileSync("redis-cli", ["-p", String(REDIS_PORT), "shutdown", "nosave"], { stdio: "ignore" }) } catch {}
  staticServer.close()
  process.exit(0)
}
