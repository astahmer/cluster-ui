import type Database from "better-sqlite3"
import { SNOWFLAKE_EPOCH } from "./config.ts"

/**
 * Write-side operations on the cluster storage. These mirror exactly what
 * @effect/cluster itself does to redeliver / interrupt work:
 * - retry/reset: clear the processed flag + last_read and drop exit replies so
 *   the entity re-executes (see SqlMessageStorage's own reset path).
 * - interrupt: append an Interrupt envelope row (kind = 2) which the cluster
 *   consumes natively.
 * - delete: remove the message row and its replies entirely (dead-letter
 *   discard).
 *
 * All functions throw ActionError with a user-facing message; the API layer
 * maps that to HTTP status codes.
 */
export class ActionError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

let seq = 0
/** fresh snowflake id for envelope rows we insert (machine id 1023 = dashboard) */
function nextSnowflake(): bigint {
  const ms = Date.now()
  seq = (seq + 1) % 4096
  return BigInt(ms - SNOWFLAKE_EPOCH) << 22n | 1023n << 12n | BigInt(seq)
}

export function assertWritable(readonly: boolean) {
  if (readonly) {
    throw new ActionError("read-only mode", 403)
  }
}

interface TargetRow {
  /** exact id as text — bigint ids lose precision as JS numbers */
  readonly idText: string
  readonly shard_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly kind: number
}

function findMessage(db: Database.Database, tables: { messages: string }, messageId: string): TargetRow {
  const row = db
    .prepare(
      `SELECT CAST(id AS TEXT) as idText, shard_id, entity_type, entity_id, kind FROM ${tables.messages} WHERE CAST(id AS TEXT) = ?`
    )
    .get(messageId) as TargetRow | undefined
  if (!row) {
    throw new ActionError(`message ${messageId} not found`, 404)
  }
  return row
}

/** Clear delivery state and drop the exit reply so the message re-executes. */
export function retryMessage(db: Database.Database, prefix: string, messageId: string): { ok: true } {
  const t = { messages: `${prefix}_messages`, replies: `${prefix}_replies` }
  const target = findMessage(db, t, messageId)
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE ${t.messages} SET processed = 0, last_read = NULL WHERE CAST(id AS TEXT) = ?`
    ).run(target.idText)
    db.prepare(
      `DELETE FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ? AND kind = 0`
    ).run(target.idText)
  })
  tx()
  return { ok: true }
}

/**
 * Reset a durable workflow activity attempt: same as retry but also drops the
 * streamed Chunk replies, forcing the activity to run from scratch.
 */
export function resetActivity(db: Database.Database, prefix: string, messageId: string): { ok: true } {
  const t = { messages: `${prefix}_messages`, replies: `${prefix}_replies` }
  const target = findMessage(db, t, messageId)
  if (!target.entity_type.startsWith("Workflow/")) {
    throw new ActionError("message is not a workflow activity", 400)
  }
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE ${t.messages} SET processed = 0, last_read = NULL WHERE CAST(id AS TEXT) = ?`
    ).run(target.idText)
    db.prepare(
      `DELETE FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ? AND (kind IS NULL OR kind = 0)`
    ).run(target.idText)
  })
  tx()
  return { ok: true }
}

/**
 * Append an Interrupt envelope for the request. The cluster's runner consumes
 * these natively and interrupts the running entity handler.
 */
export function interruptMessage(db: Database.Database, prefix: string, messageId: string): { ok: true } {
  const t = { messages: `${prefix}_messages`, replies: `${prefix}_replies` }
  const target = findMessage(db, t, messageId)
  if (Number(target.kind) !== 0) {
    throw new ActionError("can only interrupt requests", 400)
  }
  const tx = db.transaction(() => {
    // drop pending replies so no stale result wins the race
    db.prepare(`DELETE FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ?`).run(target.idText)
    db.prepare(
      `INSERT INTO ${t.messages}
         (id, message_id, shard_id, entity_type, entity_id, kind, tag, payload, headers,
          trace_id, span_id, sampled, processed, request_id, reply_id, last_reply_id, last_read, deliver_at)
       VALUES (?, NULL, ?, ?, ?, 2, NULL, NULL, NULL, NULL, NULL, 1, 1, ?, NULL, NULL, NULL, NULL)`
    ).run(String(nextSnowflake()), target.shard_id, target.entity_type, target.entity_id, BigInt(target.idText))
  })
  tx()
  return { ok: true }
}

/** Permanently remove a message and its replies (dead-letter discard). */
export function deleteMessage(db: Database.Database, prefix: string, messageId: string): { ok: true } {
  const t = { messages: `${prefix}_messages`, replies: `${prefix}_replies` }
  const target = findMessage(db, t, messageId)
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ?`).run(target.idText)
    db.prepare(`DELETE FROM ${t.messages} WHERE CAST(id AS TEXT) = ?`).run(target.idText)
  })
  tx()
  return { ok: true }
}
