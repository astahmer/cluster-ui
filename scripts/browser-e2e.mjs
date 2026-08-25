/**
 * Browser e2e for cluster-ui against a REAL chromium (via vitrine-app's
 * playwright-core) — catches runtime crashes jsdom smoke can't.
 *
 * Variants: default sqlite cluster AND local-redis (spawned + seeded here).
 * Usage: pnpm build && node scripts/browser-e2e.mjs
 */
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VITRINE_MODULES = "/Users/astahmer/dev/vitrine-app/node_modules"
const { chromium } = await import(`${VITRINE_MODULES}/playwright-core/index.mjs`)

const PORT = 8790
const REDIS_PORT = 6399
let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`)
  if (!cond) failures++
}

// --- chromium ---------------------------------------------------------------
function findChromium() {
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`
  if (!existsSync(cache)) return null
  const candidates = []
  for (const dir of readdirSync(cache).sort().reverse()) {
    if (dir.startsWith("chromium-")) {
      candidates.push(
        `${cache}/${dir}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        `${cache}/${dir}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
        `${cache}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
      )
    }
    if (dir.startsWith("chromium_headless_shell-")) {
      candidates.push(`${cache}/${dir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`)
    }
  }
  for (const c of candidates) {
    try { execFileSync("test", ["-x", c]); return c } catch {}
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) {
  console.error("no playwright chromium found in ms-playwright cache")
  process.exit(1)
}

// --- static server for dist/ ------------------------------------------------
const DIST = resolve(ROOT, "dist")
if (!existsSync(`${DIST}/index.html`)) {
  console.error("dist/ missing — run pnpm build first")
  process.exit(1)
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }
const staticServer = createServer((req, res) => {
  const path = req.url.split("?")[0]
  let file = resolve(DIST, path === "/" ? "index.html" : `.${path}`)
  if (!file.startsWith(DIST) || !existsSync(file)) file = `${DIST}/index.html` // SPA fallback
  res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" })
  res.end(readFileSync(file))
})
await new Promise((r) => staticServer.listen(PORT, r))

// --- backend ------------------------------------------------------------------
let redisProc = null
let haveRedis = false
try {
  execFileSync("which", ["redis-server"], { stdio: "ignore" })
  redisProc = spawn("redis-server", ["--port", String(REDIS_PORT), "--daemonize", "no", "--save", ""], { stdio: "ignore" })
  await new Promise((r) => setTimeout(r, 700))
  const out = execFileSync("node", ["scripts/demo-redis.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 20_000 })
  console.log("[seed]", out.match(/total ~\d+ writes/)?.[0] ?? "")
  haveRedis = true
} catch (e) {
  console.log("[redis] unavailable — sqlite variant only:", String(e).slice(0, 80))
}
const clusters =
  redisProc !== null ? `default=${resolve(ROOT, "data/cluster.db")},local-redis=redis://127.0.0.1:${REDIS_PORT}` : `default=${resolve(ROOT, "data/cluster.db")}`

const apiProc = spawn("node",
  ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/register-ts-resolve.mjs", "server/src/main.ts"],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT + 1), CLUSTER_UI_CLUSTERS: clusters }, stdio: "ignore" }
)
let apiUp = false
for (let i = 0; i < 40 && !apiUp; i++) {
  await new Promise((r) => setTimeout(r, 250))
  apiUp = await fetch(`http://127.0.0.1:${PORT + 1}/healthz`).then((r) => r.ok).catch(() => false)
}
if (!apiUp) {
  console.error("api server failed to boot")
  apiProc.kill("SIGKILL")
  redisProc?.kill("SIGKILL")
  process.exit(1)
}

mkdirSync("/tmp/cluster-ui-shots", { recursive: true })

async function runVariant(label, clusterParam) {
  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (clusterParam) {
    await context.addInitScript((c) => localStorage.setItem("cluster_ui_cluster", c), clusterParam)
  }
  // same-origin /api passthrough to the API server
  await context.route("**/mcp**", async (route) => {
    try {
      const req = route.request()
      const res = await fetch(`http://127.0.0.1:${PORT + 1}${req.url().replace(/^https?:\/\/[^/]+/, "")}`, {
        headers: req.headers(), method: req.method(), body: ["POST", "PUT"].includes(req.method()) ? req.postData() : undefined
      })
      route.fulfill({ status: res.status, contentType: res.headers.get("content-type") ?? "application/json", body: await res.text() })
    } catch (e) { route.abort(String(e)) }
  })
  await context.route("**/api/**", async (route) => {
    try {
      const req = route.request()
      const res = await fetch(`http://127.0.0.1:${PORT + 1}${req.url().replace(/^https?:\/\/[^/]+/, "")}`, {
        headers: req.headers(),
        method: req.method(),
        body: ["POST", "PUT"].includes(req.method()) ? req.postData() : undefined
      })
      route.fulfill({
        status: res.status,
        contentType: res.headers.get("content-type") ?? "application/json",
        body: await res.text()
      })
    } catch (e) {
      route.abort(String(e))
    }
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 200)}`))
  page.on("response", (r) => r.status() >= 400 && r.url().includes('/api/') && errors.push(`http ${r.status()}: ${r.url().split('?')[0]}`))

  const goto = async (hash, waitMs = 1500) => {
    await page.goto(`http://localhost:${PORT}/#${hash}`, { waitUntil: "networkidle" }).catch(() => {})
    await page.waitForTimeout(waitMs)
  }
  const bodyText = () => page.evaluate(() => document.body.textContent)

  // --- overview ---
  await goto("/", 2500)
  check(`[${label}] overview renders stat cards`, (await bodyText()).includes("Pending") && (await bodyText()).includes("Failed"))
  check(`[${label}] overview no page errors`, errors.length === 0)
  if (errors.length > 0) console.log("   ", errors.slice(0, 3))
  await page.screenshot({ path: `/tmp/cluster-ui-shots/overview-${label}.png` })

  // --- entities -> instances (reported crash site) ---
  await goto("/entities")
  check(`[${label}] entities table renders`, !(await bodyText()).includes("rows is not iterable"))
  const entityLink = page.locator('a[href^="#/entities/"]').first()
  if ((await entityLink.count()) > 0) {
    await entityLink.click()
    await page.waitForTimeout(1500)
    check(`[${label}] entity-instances renders without crash`, errors.length === 0)
    if (errors.length > 0) console.log("   ", errors.slice(0, 3))
  } else if (label === "sqlite") {
    check("[sqlite] entity link present", false)
  }
  await page.screenshot({ path: `/tmp/cluster-ui-shots/entities-${label}.png` })

  // --- messages + row click (envelope regression) ---
  await goto("/messages")
  const row = page.locator("table tbody tr").first()
  if ((await row.count()) > 0) {
    await row.click()
    await page.waitForTimeout(1500)
    check(`[${label}] message detail opens without crash`, errors.length === 0)
    if (errors.length > 0) console.log("   ", errors.slice(0, 3))
  } else {
    check(`[${label}] messages rows present`, false)
  }
  await page.screenshot({ path: `/tmp/cluster-ui-shots/messages-${label}.png` })

  // --- singletons (500 regression from screenshot) ---
  await goto("/singletons")
  check(`[${label}] singletons loads without Error banner`, !(await bodyText()).includes("Error: 5"))
  check(`[${label}] singletons no page errors`, errors.length === 0)

  // --- workflows + DAG toggle ---
  await goto("/workflows")
  await page.waitForTimeout(800)
  const wfLink = page.locator('a[href^="#/workflows/"]').first()
  if ((await wfLink.count()) > 0) {
    await wfLink.click()
    await page.waitForTimeout(1500)
    const dagButton = page.locator("button", { hasText: "DAG" }).first()
    if ((await dagButton.count()) > 0) {
      await dagButton.click()
      await page.waitForTimeout(1000)
      check(`[${label}] workflow flow-DAG renders without crash`, errors.length === 0)
      if (errors.length > 0) console.log("   ", errors.slice(0, 3))
      await page.screenshot({ path: `/tmp/cluster-ui-shots/workflow-dag-${label}.png` })
    }
  }

  // --- agent + mcp pages render ---
  await goto("/agent", 1200)
  check(`[${label}] agent page renders`, (await bodyText()).includes("Ask about your cluster"))
  await goto("/mcp", 1200)
  check(`[${label}] mcp page renders tools`, (await bodyText()).includes("query_messages"))

  await browser.close()
}

try {
  await runVariant("sqlite", null)
  if (haveRedis) await runVariant("redis", "local-redis")
} finally {
  apiProc?.kill("SIGKILL")
  redisProc?.kill("SIGKILL")
  try { execFileSync("redis-cli", ["-p", String(REDIS_PORT), "shutdown", "nosave"], { stdio: "ignore" }) } catch {}
  staticServer.close()
}

console.log(failures === 0 ? "\nBROWSER E2E PASS" : `\n${failures} BROWSER E2E FAILURES`)
process.exit(failures === 0 ? 0 : 1)
