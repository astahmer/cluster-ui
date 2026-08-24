/**
 * Demo reporter endpoint for the seeded dashboard.
 *
 * Serves plausible singleton/entity-memory state on :9199 — the seed data
 * registers a runner at 127.0.0.1:9199, so with this running the Singletons
 * page shows one fully-reporting runner next to unreachable ones.
 *
 *   pnpm demo-runner
 */
import { createServer } from "node:http"

const state = {
  singletons: [
    { name: "ClusterCron/scheduler", address: "127.0.0.1:9199", startedAt: Date.now() - 3_600_000 },
    { name: "MailboxRouter/global", address: "127.0.0.1:9199", startedAt: Date.now() - 3_600_000 },
    { name: "Session janitor", address: "127.0.0.1:9199", startedAt: Date.now() - 600_000 }
  ],
  entitiesInMemory: 12,
  registeredEntityTypes: ["Mailbox", "Session", "WorkflowRunner", "CronJob"]
}

const server = createServer((req, res) => {
  if (req.url === "/internal/cluster-ui/state") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(state))
    return
  }
  res.writeHead(404)
  res.end("not found (demo reporter only serves /internal/cluster-ui/state)")
})

const port = Number(process.env.REPORTER_PORT ?? 9199)
server.listen(port, () => console.log(`demo cluster-ui reporter on http://127.0.0.1:${port}`))
