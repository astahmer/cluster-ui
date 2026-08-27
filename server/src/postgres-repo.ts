import postgres from "postgres";
import { decodeSnowflake, SNOWFLAKE_EPOCH } from "./config.ts";
import {
  extractResult,
  kindName,
  safeJson,
  statusOf,
  toMessageView,
  type MessageQuery,
  type RawMessageRow,
  type Repo,
} from "./queries.ts";

const INFLIGHT_WINDOW_MS = 5 * 60 * 1000;
type PgRow = Record<string, any>;

const quoteIdentifier = (value: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("invalid cluster table prefix");
  return `"${value}"`;
};

const dollarize = (statement: string): string => {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
};

const toRawMessageRow = (row: PgRow): RawMessageRow => ({
  id: String(row.id),
  request_id: row.request_id === null || row.request_id === undefined ? null : String(row.request_id),
  message_id: row.message_id === null ? null : String(row.message_id),
  shard_id: String(row.shard_id),
  entity_type: String(row.entity_type),
  entity_id: String(row.entity_id),
  kind: Number(row.kind),
  tag: row.tag === null ? null : String(row.tag),
  payload: row.payload === null ? null : String(row.payload),
  headers: row.headers === null ? null : String(row.headers),
  trace_id: row.trace_id === null ? null : String(row.trace_id),
  processed: Number(row.processed),
  last_read:
    row.last_read instanceof Date
      ? row.last_read.toISOString()
      : row.last_read === null
        ? null
        : String(row.last_read),
  deliver_at: row.deliver_at === null ? null : String(row.deliver_at),
  reply_count: row.reply_count === undefined ? undefined : Number(row.reply_count),
  failed_flag: Number(row.failed_flag ?? 0),
});

const numberValue = (value: unknown): number => Number(value ?? 0);

const failedExists = (replies: string, idExpression: string): string =>
  `EXISTS (SELECT 1 FROM ${replies} r WHERE r.request_id = ${idExpression} AND r.kind = 0 AND r.payload::jsonb ->> '_tag' = 'Failure')`;

const makePostgresRepo = (url: string, prefix = "cluster"): Repo => {
  const sql = postgres(url, { max: 3, idle_timeout: 30, connect_timeout: 5 });
  const messages = quoteIdentifier(`${prefix}_messages`);
  const replies = quoteIdentifier(`${prefix}_replies`);
  const runners = quoteIdentifier(`${prefix}_runners`);
  const shards = quoteIdentifier(`${prefix}_shards`);
  let shardsTableExists: boolean | undefined;

  const query = async <T extends PgRow = PgRow>(
    statement: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => (await sql.unsafe(dollarize(statement), params as any)) as unknown as T[];

  const hasShardsTable = async (): Promise<boolean> => {
    if (shardsTableExists !== undefined) return shardsTableExists;
    const rows = await query<{ relation: string | null }>("SELECT to_regclass(?) AS relation", [
      `${prefix}_shards`,
    ]);
    shardsTableExists = rows[0]?.relation !== null && rows[0]?.relation !== undefined;
    return shardsTableExists;
  };

  const cutoff = () => new Date(Date.now() - INFLIGHT_WINDOW_MS);
  const statusFrom = (row: PgRow) =>
    statusOf({
      processed: Number(row.processed),
      deliverAt: row.deliver_at === null ? null : Number(row.deliver_at),
      lastRead:
        row.last_read instanceof Date
          ? row.last_read.toISOString()
          : row.last_read === null
            ? null
            : String(row.last_read),
    });

  const listMessages = async (input: MessageQuery = {}) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (condition: string, ...values: unknown[]) => {
      conditions.push(condition);
      params.push(...values);
    };
    if (input.status === "done") add("m.processed = TRUE");
    else if (input.status === "pending")
      add("m.processed = FALSE AND (m.deliver_at IS NULL OR m.deliver_at <= ?)", Date.now());
    else if (input.status === "scheduled")
      add("m.processed = FALSE AND m.deliver_at IS NOT NULL AND m.deliver_at > ?", Date.now());
    else if (input.status === "inflight")
      add("m.processed = FALSE AND m.last_read IS NOT NULL AND m.last_read > ?", cutoff());
    if (input.entityType) add("m.entity_type = ?", input.entityType);
    if (input.entityId) add("m.entity_id = ?", input.entityId);
    if (input.q) {
      const pattern = `%${input.q}%`;
      add("(m.entity_id LIKE ? OR m.tag LIKE ? OR m.id::text LIKE ?)", pattern, pattern, pattern);
    }
    if (input.failed === true || input.failed === "true") add(failedExists(replies, "m.id"));
    if (input.failed === false || input.failed === "false")
      add(`NOT ${failedExists(replies, "m.id")}`);
    if (input.createdAfter !== undefined) add("m.id >= ?", snowflakeFloor(input.createdAfter));
    if (input.createdBefore !== undefined) add("m.id <= ?", snowflakeCeil(input.createdBefore));

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 200);
    const page = Math.max(input.page ?? 1, 1);
    const order =
      input.sort === "deliverAt"
        ? "ORDER BY (m.deliver_at IS NULL), m.deliver_at ASC, m.id DESC"
        : "ORDER BY m.id DESC";
    const totalRows = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${messages} m ${where}`,
      params,
    );
    const rows = await query(
      `SELECT m.id::text AS id, m.request_id, m.message_id, m.shard_id, m.entity_type, m.entity_id,
         m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
         (${failedExists(replies, "m.id")})::int AS failed_flag,
         (SELECT COUNT(*) FROM ${replies} r WHERE r.request_id = m.id)::text AS reply_count
       FROM ${messages} m ${where}
       ${order} LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return {
      rows: rows.map((row) => toMessageView(toRawMessageRow(row))),
      total: numberValue(totalRows[0]?.total),
      page,
      pageSize,
    };
  };

  const getMessage = async (id: string) => {
    const rows = await query(
      `SELECT m.id::text AS id, m.request_id, m.message_id, m.shard_id, m.entity_type, m.entity_id,
         m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
         (${failedExists(replies, "m.id")})::int AS failed_flag
       FROM ${messages} m WHERE m.id::text = ?`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const replyRows = await query(
      `SELECT id::text AS rid, request_id::text AS "requestId", kind, payload, sequence, acked
       FROM ${replies} WHERE request_id::text = ? ORDER BY sequence`,
      [id],
    );
    const mappedReplies = replyRows.map((reply) => ({
      id: String(reply.rid),
      requestId: String(reply.requestId),
      kind:
        reply.kind === null
          ? "chunk"
          : Number(reply.kind) === 0
            ? "withExit"
            : `kind:${reply.kind}`,
      payload: safeJson(String(reply.payload)),
      sequence: reply.sequence === null ? null : Number(reply.sequence),
      acked: Boolean(reply.acked),
    }));
    return {
      message: toMessageView(toRawMessageRow(row)),
      payload: safeJson(row.payload === null ? null : String(row.payload)),
      headers: safeJson(row.headers === null ? null : String(row.headers)),
      result: extractResult(mappedReplies),
      replies: mappedReplies,
    };
  };

  const overview = async () => {
    const now = Date.now();
    const cutoffValue = cutoff();
    const messageRows = await query(
      `SELECT
        COUNT(*) FILTER (WHERE processed = TRUE)::text AS done,
        COUNT(*) FILTER (WHERE processed = FALSE AND deliver_at IS NOT NULL AND deliver_at > ?)::text AS scheduled,
        COUNT(*) FILTER (WHERE processed = FALSE AND last_read IS NOT NULL AND last_read > ?)::text AS inflight,
        COUNT(*) FILTER (WHERE processed = FALSE)::text AS unprocessed,
        COUNT(*) FILTER (WHERE ${failedExists(replies, "m.id")})::text AS failed
       FROM ${messages} m`,
      [now, cutoffValue],
    );
    const shardRows = (await hasShardsTable())
      ? await query(
          `SELECT COUNT(*)::text AS total, COUNT(address)::text AS assigned FROM ${shards}`,
        )
      : [{ total: "0", assigned: "0" }];
    const runnerRows = await query(`SELECT COUNT(*)::text AS total FROM ${runners}`);
    const topEntities = await query(
      `SELECT entity_type AS "entityType", COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE processed = FALSE)::text AS active
       FROM ${messages} GROUP BY entity_type ORDER BY COUNT(*) DESC LIMIT 8`,
    );
    const topWorkflows = await query(
      `SELECT SUBSTRING(entity_type FROM 10) AS name, COUNT(DISTINCT entity_id)::text AS runs
       FROM ${messages} WHERE entity_type LIKE 'Workflow/%'
       GROUP BY entity_type ORDER BY COUNT(DISTINCT entity_id) DESC LIMIT 8`,
    );
    const counts = messageRows[0] ?? {};
    const pending =
      numberValue(counts.unprocessed) -
      numberValue(counts.scheduled) -
      numberValue(counts.inflight);
    const shardTotal = numberValue(shardRows[0]?.total);
    const assigned = numberValue(shardRows[0]?.assigned);
    return {
      messages: {
        pending,
        inflight: numberValue(counts.inflight),
        scheduled: numberValue(counts.scheduled),
        done: numberValue(counts.done),
        failed: numberValue(counts.failed),
      },
      runners: { total: numberValue(runnerRows[0]?.total) },
      shards: { total: shardTotal, assigned },
      unassignedShards: shardTotal - assigned,
      topEntities: topEntities.map((row) => ({
        entityType: String(row.entityType),
        total: numberValue(row.total),
        active: numberValue(row.active),
      })),
      topWorkflows: topWorkflows.map((row) => ({
        name: String(row.name),
        runs: numberValue(row.runs),
      })),
      serverTime: now,
    };
  };

  const runnersQuery = async () => {
    const hasShards = await hasShardsTable();
    const rows = await query(
      hasShards
        ? `SELECT r.address, r.runner, (SELECT COUNT(*) FROM ${shards} s WHERE s.address = r.address)::text AS shards FROM ${runners} r ORDER BY r.address`
        : `SELECT r.address, r.runner, '0' AS shards FROM ${runners} r ORDER BY r.address`,
    );
    return rows.map((row) => {
      let runner: PgRow | null = null;
      try {
        runner = JSON.parse(String(row.runner)) as PgRow;
      } catch {}
      const shardCount = numberValue(row.shards);
      return {
        address: String(row.address),
        host: runner?.address?.host ?? null,
        port: runner?.address?.port ?? null,
        groups: runner?.groups ?? [],
        version: runner?.version ?? null,
        shards: shardCount,
        stale: shardCount === 0,
      };
    });
  };

  const shardsQuery = async () => {
    if (!(await hasShardsTable())) return [];
    const rows = await query(
      `SELECT shard_id::text AS "shardId", address FROM ${shards} ORDER BY shard_id::int`,
    );
    return rows.map((row) => ({
      shardId: String(row.shardId),
      address: row.address === null ? null : String(row.address),
    }));
  };

  const entities = async () => {
    const rows = await query(
      `SELECT entity_type AS "entityType", COUNT(DISTINCT entity_id)::text AS entities, COUNT(*)::text AS messages,
        COUNT(*) FILTER (WHERE processed = TRUE)::text AS done,
        COUNT(*) FILTER (WHERE processed = FALSE AND deliver_at IS NOT NULL AND deliver_at > ?)::text AS scheduled,
        COUNT(*) FILTER (WHERE processed = FALSE AND last_read IS NOT NULL AND last_read > ?)::text AS inflight,
        MAX(id)::text AS "lastId"
       FROM ${messages} GROUP BY entity_type ORDER BY COUNT(*) DESC`,
      [Date.now(), cutoff()],
    );
    return rows.map((row) => {
      const total = numberValue(row.messages);
      const done = numberValue(row.done);
      const scheduled = numberValue(row.scheduled);
      const inflight = numberValue(row.inflight);
      return {
        entityType: String(row.entityType),
        entities: numberValue(row.entities),
        messages: total,
        done,
        scheduled,
        inflight,
        pending: total - done - scheduled - inflight,
        lastActivityAt: row.lastId ? decodeSnowflake(String(row.lastId)).createdAt : null,
      };
    });
  };

  const entityInstances = async (
    entityType: string,
    opts: { q?: string; page?: number; pageSize?: number } = {},
  ) => {
    const conditions = ["m.entity_type = ?"];
    const params: unknown[] = [entityType];
    if (opts.q) {
      conditions.push("m.entity_id LIKE ?");
      params.push(`%${opts.q}%`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const inner = `SELECT m.entity_id AS "entityId", COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE m.processed = TRUE)::text AS done,
      COUNT(*) FILTER (WHERE m.processed = FALSE AND m.deliver_at IS NOT NULL AND m.deliver_at > ${Date.now()})::text AS scheduled,
      COUNT(*) FILTER (WHERE m.processed = FALSE AND m.last_read IS NOT NULL AND m.last_read > '${cutoff().toISOString()}')::text AS inflight,
      COUNT(*) FILTER (WHERE ${failedExists(replies, "m.id")})::text AS failed,
      MAX(m.id)::text AS "lastId"
      FROM ${messages} m ${where} GROUP BY m.entity_id`;
    const totalRows = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM (${inner}) AS grouped`,
      params,
    );
    const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
    const page = Math.max(opts.page ?? 1, 1);
    const rows = await query(
      `SELECT * FROM (${inner}) AS grouped ORDER BY "lastId" DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return {
      rows: rows.map((row) => {
        const total = numberValue(row.total),
          done = numberValue(row.done),
          scheduled = numberValue(row.scheduled),
          inflight = numberValue(row.inflight);
        return {
          entityId: String(row.entityId),
          total,
          pending: total - done - scheduled - inflight,
          inflight,
          scheduled,
          done,
          failed: numberValue(row.failed),
          lastActivityAt: row.lastId ? decodeSnowflake(String(row.lastId)).createdAt : null,
        };
      }),
      total: numberValue(totalRows[0]?.total),
      page,
      pageSize,
    };
  };

  const crons = async () => {
    const rows = await query(
      `SELECT SUBSTRING(entity_type FROM 13) AS name, entity_type AS "entityType", id::text AS id, processed, deliver_at FROM ${messages} WHERE entity_type LIKE 'ClusterCron/%' ORDER BY id ASC`,
    );
    const byJob = new Map<string, PgRow>();
    for (const row of rows) {
      const entityType = String(row.entityType);
      let job = byJob.get(entityType);
      if (!job) {
        job = {
          name: String(row.name),
          entityType,
          lastRunAt: null,
          nextRunAt: null,
          newestId: null,
          lastProcessed: false,
        };
        byJob.set(entityType, job);
      }
      job.newestId = String(row.id);
      job.lastProcessed = Boolean(row.processed);
      if (Boolean(row.processed))
        job.lastRunAt = Math.max(job.lastRunAt ?? 0, decodeSnowflake(String(row.id)).createdAt);
      if (!Boolean(row.processed) && row.deliver_at !== null) {
        const at = numberValue(row.deliver_at);
        job.nextRunAt = job.nextRunAt === null ? at : Math.min(job.nextRunAt, at);
      }
    }
    const now = Date.now();
    return [...byJob.values()].map((job) => ({
      name: job.name,
      entityType: job.entityType,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
      lastStatus:
        job.newestId !== null
          ? statusOf({ processed: job.lastProcessed ? 1 : 0, deliverAt: null, lastRead: null })
          : "pending",
      overdue: job.nextRunAt !== null && job.nextRunAt < now,
    }));
  };

  const workflows = async () => {
    const rows =
      await query(`SELECT SUBSTRING(entity_type FROM 10) AS name, COUNT(DISTINCT entity_id)::text AS runs,
      COUNT(*) FILTER (WHERE tag = 'run' AND processed = TRUE)::text AS "completedRuns",
      COUNT(*) FILTER (WHERE tag = 'run' AND processed = FALSE)::text AS "activeRuns",
      COUNT(*) FILTER (WHERE tag = 'run' AND ${failedExists(replies, "m.id")})::text AS "failedRuns",
      MAX(id)::text AS "lastId" FROM ${messages} m WHERE entity_type LIKE 'Workflow/%' GROUP BY entity_type ORDER BY name`);
    return rows.map((row) => ({
      name: String(row.name),
      runs: numberValue(row.runs),
      completedRuns: numberValue(row.completedRuns),
      activeRuns: numberValue(row.activeRuns),
      failedRuns: numberValue(row.failedRuns),
      lastActivityAt: row.lastId ? decodeSnowflake(String(row.lastId)).createdAt : null,
    }));
  };

  const workflowRuns = async (name: string) => {
    const rows = await query(
      `SELECT m.id::text AS id, m.entity_id, m.entity_type, m.request_id, m.message_id, m.shard_id, m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at, (${failedExists(replies, "m.id")})::int AS failed_flag, (SELECT COUNT(*) FROM ${replies} r WHERE r.request_id = m.id)::text AS reply_count FROM ${messages} m WHERE m.entity_type = ? AND m.tag = 'run' ORDER BY m.id DESC`,
      [`Workflow/${name}`],
    );
    return rows.map((row) => {
      const view = toMessageView(
        toRawMessageRow({ ...row, kind: 0, tag: "run", entity_type: `Workflow/${name}` }),
      );
      return {
        executionId: String(view.entityId),
        runMessageId: String(row.id),
        status: view.status,
        failed: view.failed,
        createdAt: view.createdAt,
        activityCount: numberValue(row.reply_count),
      };
    });
  };

  const workflowRun = async (name: string, executionId: string) => {
    const rows = await query(
      `SELECT m.id::text AS id, m.request_id, m.message_id, m.shard_id, m.entity_type, m.entity_id, m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at, (${failedExists(replies, "m.id")})::int AS failed_flag FROM ${messages} m WHERE m.entity_type = ? AND m.entity_id = ? ORDER BY m.id`,
      [`Workflow/${name}`, executionId],
    );
    if (rows.length === 0) return null;
    const runRow = rows.find((row) => row.tag === "run");
    const activities = rows
      .filter((row) => row.tag !== "run")
      .map((row) => {
        const payload = safeJson(row.payload === null ? null : String(row.payload));
        let activityName: string | undefined, attempt: number | undefined;
        if (payload && typeof payload === "object" && "attempt" in payload) {
          attempt = numberValue((payload as PgRow).attempt);
          activityName = String((payload as PgRow).name ?? "");
        }
        return {
          id: String(row.id),
          tag: row.tag === null ? null : String(row.tag),
          kind: kindName(Number(row.kind)),
          status: statusFrom(row),
          failed: Number(row.failed_flag ?? 0) === 1,
          activityName,
          attempt,
          payload,
          createdAt: decodeSnowflake(String(row.id)).createdAt,
        };
      });
    const eventHistory = rows.map((row) => {
      const activity = activities.find((item) => item.id === String(row.id));
      return {
        id: String(row.id),
        timestamp: decodeSnowflake(String(row.id)).createdAt,
        event:
          row.tag === "run"
            ? "run-created"
            : activity?.failed
              ? "activity-failed"
              : `activity-${activity?.status ?? "pending"}`,
        activityName: activity?.activityName,
        attempt: activity?.attempt,
        payload: safeJson(row.payload === null ? null : String(row.payload)),
      };
    });
    const run = runRow
      ? (() => {
          const view = toMessageView(
            toRawMessageRow({ ...runRow, entity_type: `Workflow/${name}`, entity_id: executionId }),
          );
          return query(`SELECT kind, payload FROM ${replies} WHERE request_id::text = ?`, [
            String(runRow.id),
          ]).then((replyRows) => {
            const mapped = replyRows.map((reply) => ({
              kind:
                reply.kind === null
                  ? "chunk"
                  : Number(reply.kind) === 0
                    ? "withExit"
                    : `kind:${reply.kind}`,
              payload: safeJson(String(reply.payload)),
            }));
            return {
              ...view,
              payload: safeJson(runRow.payload === null ? null : String(runRow.payload)),
              result: extractResult(mapped),
            };
          });
        })()
      : null;
    return { run: await run, activities, eventHistory };
  };

  const traces = async (
    opts: {
      limit?: number;
      offset?: number;
      q?: string;
      createdAfter?: number;
      createdBefore?: number;
    } = {},
  ) => {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200),
      offset = Math.max(opts.offset ?? 0, 0);
    const clauses = ["m.trace_id IS NOT NULL AND m.trace_id != ''"],
      params: unknown[] = [];
    if (opts.q?.trim()) {
      clauses.push("m.trace_id LIKE ? ESCAPE '\\\\'");
      params.push(`%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (opts.createdAfter !== undefined) {
      clauses.push("m.id >= ?");
      params.push(snowflakeFloor(opts.createdAfter));
    }
    if (opts.createdBefore !== undefined) {
      clauses.push("m.id <= ?");
      params.push(snowflakeCeil(opts.createdBefore));
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const totalRows = await query<{ total: string }>(
      `SELECT COUNT(DISTINCT m.trace_id)::text AS total FROM ${messages} m ${where}`,
      params,
    );
    const rows = await query(
      `SELECT m.trace_id AS "traceId", COUNT(*)::text AS count, SUM(CASE WHEN ${failedExists(replies, "m.id")} THEN 1 ELSE 0 END)::text AS "failedCount", MIN(m.id)::text AS "firstId", MAX(m.id)::text AS "lastId", ARRAY_AGG(DISTINCT m.kind) AS kinds, ARRAY_AGG(DISTINCT m.entity_type) AS services FROM ${messages} m ${where} GROUP BY m.trace_id ORDER BY MAX(m.id) DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return {
      rows: rows.map((row) => ({
        traceId: String(row.traceId),
        count: numberValue(row.count),
        failedCount: numberValue(row.failedCount),
        kinds: Array.isArray(row.kinds) ? row.kinds.map((kind) => kindName(Number(kind))) : [],
        services: Array.isArray(row.services) ? row.services.map(String) : [],
        firstAt: decodeSnowflake(String(row.firstId)).createdAt,
        lastAt: decodeSnowflake(String(row.lastId)).createdAt,
      })),
      total: numberValue(totalRows[0]?.total),
    };
  };

  const trace = async (traceId: string) => {
    const rows = await query(
      `SELECT m.id::text AS id, m.request_id, m.message_id, m.shard_id, m.entity_type, m.entity_id, m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at, (${failedExists(replies, "m.id")})::int AS failed_flag, (SELECT COUNT(*) FROM ${replies} r WHERE r.request_id = m.id)::text AS reply_count FROM ${messages} m WHERE m.trace_id = ? ORDER BY m.id ASC`,
      [traceId],
    );
    return rows.map((row) => toMessageView(toRawMessageRow(row)));
  };

  return {
    db: null,
    kind: "postgres",
    prefix,
    listMessages,
    getMessage,
    overview,
    runners: runnersQuery,
    shards: shardsQuery,
    entities,
    entityInstances,
    crons,
    workflows,
    workflowRuns,
    workflowRun,
    traces,
    trace,
  } as unknown as Repo;
};

export { makePostgresRepo };

function snowflakeCeil(atMs: number): string {
  return String(
    ((BigInt(Math.max(atMs, SNOWFLAKE_EPOCH)) - BigInt(SNOWFLAKE_EPOCH)) << 22n) |
      ((1n << 22n) - 1n),
  );
}

function snowflakeFloor(atMs: number): string {
  return String((BigInt(Math.max(atMs, SNOWFLAKE_EPOCH)) - BigInt(SNOWFLAKE_EPOCH)) << 22n);
}
