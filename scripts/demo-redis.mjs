#!/usr/bin/env node
/**
 * Demo BullMQ seeder — populates a local redis on :6399 with realistic queues,
 * jobs across every state, and one parent/child flow, matching exactly what
 * cluster-ui's redis-repo reads (docs/ROADMAP.md §6).
 *
 *   pnpm dev:redis    # start redis-server on :6399 (foreground)
 *   pnpm seed:redis   # flush + seed demo data
 */
import Redis from "ioredis"

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399"
const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: () => null
})

const now = Date.now()
const HOUR = 3_600_000

let seq = 0
function jobId() {
  return String(now - ++seq)
}

async function seedJob(queue, { id = jobId(), name, state, data, opts = {} }) {
  const key = `bull:${queue}:${id}`
  const fields = {
    name,
    data: JSON.stringify(data ?? {}),
    timestamp: String(opts.timestamp ?? now),
    attemptsMade: String(opts.attemptsMade ?? (state === "completed" || state === "failed" ? 1 : 0)),
    delay: String(opts.delay ?? 0),
    ...(opts.processedOn !== undefined ? { processedOn: String(opts.processedOn) } : {}),
    ...(opts.finishedOn !== undefined ? { finishedOn: String(opts.finishedOn) } : {}),
    ...(opts.parentKey !== undefined ? { parentKey: opts.parentKey } : {}),
    ...(state === "completed" && opts.returnValue !== undefined
      ? { returnvalue: JSON.stringify(opts.returnValue) }
      : {}),
    ...(state === "failed" && opts.failedReason !== undefined
      ? { failedReason: opts.failedReason }
      : {}),
    ...(state === "failed" && opts.stacktrace !== undefined
      ? { stacktrace: JSON.stringify([opts.stacktrace]) }
      : {})
  }
  await redis.hset(key, fields)

  switch (state) {
    case "wait":
      await redis.lpush(`bull:${queue}:wait`, id)
      break
    case "active":
      await redis.lpush(`bull:${queue}:active`, id)
      break
    case "delayed":
      await redis.zadd(`bull:${queue}:delayed`, opts.delayUntil ?? now + HOUR, id)
      break
    case "completed": {
      const score = opts.finishedOn ?? now
      await redis.zadd(`bull:${queue}:completed`, score, id)
      break
    }
    case "failed": {
      const score = opts.finishedOn ?? now
      await redis.zadd(`bull:${queue}:failed`, score, id)
      break
    }
  }

  // bookkeeping set of known job ids for the queue
  await redis.sadd(`bull:${queue}:id`, id)
  return { queue, id, key }
}

async function main() {
  try {
    await redis.connect()
  } catch {
    console.error(
      `Cannot reach redis at ${REDIS_URL}.\nStart it first with:\n\n  pnpm dev:redis\n`
    )
    process.exit(1)
  }

  console.log(`Flushing ${REDIS_URL}...`)
  await redis.flushdb()

  let created = 0

  // ---- completed history: spread over the last 48h -------------------------
  const completedSpecs = [
    ["emails", "sendEmail", (i) => ({ to: `user${i}@example.com`, template: "welcome" }), { delivered: true }],
    ["payments", "charge", (i) => ({ amountCents: 1000 + i * 37, currency: "EUR" }), (i) => ({ chargeId: `ch_${i}` })],
    ["images", "resize", (i) => ({ url: `https://cdn.example.com/img/${i}.png`, w: 256 }), (i) => ({ bytes: 40_000 + i })],
    ["reports", "buildReport", (i) => ({ kind: i % 2 ? "weekly" : "daily" }), (i) => ({ rows: 120 * i })]
  ]
  for (let h = 47; h >= 0; h -= 3) {
    for (const [queue, name, mkData, mkReturn] of completedSpecs) {
      const ts = now - h * HOUR
      await seedJob(queue, {
        name,
        state: "completed",
        data: mkData(h),
        opts: {
          timestamp: ts,
          processedOn: ts,
          finishedOn: ts + 900,
          returnValue: typeof mkReturn === "function" ? mkReturn(h) : mkReturn
        }
      })
      created++
    }
  }

  // ---- failures with reasons + stacktraces ---------------------------------
  const failureSpecs = [
    ["payments", "charge", "StripeConnectionError: connect ETIMEDOUT 44.208.151.1:443", "at ChargeService.charge (src/payments/charge.ts:88)\nat processTicksAndRejections"],
    ["emails", "sendEmail", "SMTPError: 550 recipient rejected", "at SmtpTransport.send (src/mail/smtp.ts:41)"],
    ["webhooks", "deliverWebhook", "HttpError: 502 Bad Gateway from https://hooks.example.com/x", "at deliver (src/webhooks/deliver.ts:63)\nat RetryPolicy.wrap (src/util/retry.ts:12)"],
    ["images", "resize", "Error: input buffer contains unsupported image format", "at sharp.pipeline (node_modules/sharp/lib/index.js)"],
    ["payments", "charge", "CardDeclinedError: insufficient_funds", "at ChargeService.charge (src/payments/charge.ts:95)"]
  ]
  for (let i = 0; i < 8; i++) {
    const [queue, name, reason, stack] = failureSpecs[i % failureSpecs.length]
    const ts = now - i * 2 * HOUR - 5 * 60_000
    await seedJob(queue, {
      name,
      state: "failed",
      data: { attempt: i },
      opts: {
        timestamp: ts,
        processedOn: ts,
        finishedOn: ts + 1200,
        attemptsMade: 3,
        failedReason: `${reason}${i >= failureSpecs.length ? " (retry)" : ""}`,
        stacktrace: stack
      }
    })
    created++
  }

  // ---- wait / active / delayed ---------------------------------------------
  const waitSpecs = [
    ["emails", "sendEmail", { to: "alice@example.com", template: "invoice" }, 4],
    ["emails", "sendEmail", { to: "bob@example.com", template: "digest" }, 4],
    ["notifications", "push", { userId: "u_123", text: "Your report is ready" }, 3],
    ["notifications", "push", { userId: "u_456", text: "Welcome!" }, 2],
    ["webhooks", "deliverWebhook", { url: "https://api.partner.dev/hook", event: "payment.succeeded" }, 2],
    ["images", "resize", { url: "https://cdn.example.com/banner.png", w: 1280 }, 2],
    ["reports", "buildReport", { kind: "weekly" }, 2]
  ]
  for (const [queue, name, data, n] of waitSpecs) {
    for (let i = 0; i < n; i++) {
      await seedJob(queue, { name, state: "wait", data: { ...data, seq: i } })
      created++
    }
  }

  for (const [queue, name, data] of [
    ["payments", "charge", { amountCents: 2500, currency: "USD" }],
    ["images", "resize", { url: "https://cdn.example.com/live.png", w: 512 }],
    ["emails", "sendEmail", { to: "carol@example.com", template: "reset" }]
  ]) {
    await seedJob(queue, { name, state: "active", data })
    created++
  }

  for (let i = 0; i < 5; i++) {
    const queues = ["emails", "notifications", "reports", "webhooks", "payments"]
    await seedJob(queues[i], {
      name: "scheduledTick",
      state: "delayed",
      data: { tick: i },
      opts: { delayUntil: now + (i + 1) * 15 * 60_000, delay: (i + 1) * 15 * 60_000 }
    })
    created++
  }

  // ---- one parent/child flow (for the DAG view) ----------------------------
  const parent = await seedJob("emails", "sendWeeklyDigest", {
    state: "active",
    data: { digestFor: "2026-W35" },
    opts: { parentKey: undefined }
  })
  const parentKey = `bull:${parent.queue}:${parent.id}`
  // parents track their children in a set at <parentKey>:children; register the
  // parent in its own children set bookkeeping as an empty container
  await redis.del(`${parentKey}:children`)

  for (const [childQueue, childName] of [
    ["images", "renderChart"],
    ["images", "renderTable"],
    ["reports", "exportPdf"]
  ]) {
    const child = await seedJob(childQueue, {
      name: childName,
      state: "wait",
      data: { forParent: parent.id },
      opts: { parentKey }
    })
    // BullMQ records each child as <queue>:<jobId> on the parent's flow
    await redis.sadd(`${parentKey}:children`, `${childQueue}:${child.id}`)
    created++
  }

  // ---- one paused queue -----------------------------------------------------
  await seedJob("webhooks", "pausedTick", { state: "wait", data: { note: "queued while paused" } })
  created++
  await redis.rpush("bull:webhooks:paused", "1")

  const counts = {}
  for (const q of ["emails", "payments", "images", "reports", "notifications", "webhooks"]) {
    counts[q] = await redis.scard(`bull:${q}:id`)
  }

  console.log("Seeded demo BullMQ data:")
  for (const [q, n] of Object.entries(counts)) console.log(`  ${q.padEnd(14)} ${n} jobs`)
  console.log(`  total ~${created} writes · flow root: ${parentKey}`)
  console.log("\nStart the dashboard with this cluster included:")
  console.log('  CLUSTER_UI_CLUSTERS=default=./data/cluster.db,local-redis=redis://127.0.0.1:6399 pnpm dev:server')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => redis.disconnect())
