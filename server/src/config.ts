/** Server configuration from environment variables. */
export const config = {
  /** SQLite database file (the cluster's SqlShardStorage / SqlMessageStorage DB) */
  dbFile: process.env.CLUSTER_UI_DB ?? "./data/cluster.db",
  /** Table prefix used when the cluster storages were created (default "cluster") */
  prefix: process.env.CLUSTER_UI_PREFIX ?? "cluster",
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  readonly: process.env.CLUSTER_UI_READONLY === "1"
}

/** Effect cluster Snowflake epoch — ids encode their creation timestamp. */
export const SNOWFLAKE_EPOCH = Date.UTC(2025, 0, 1)

export function decodeSnowflake(id: string): {
  createdAt: number
  machineId: number
  sequence: number
} {
  const big = BigInt(id)
  return {
    createdAt: SNOWFLAKE_EPOCH + Number(big >> 22n),
    machineId: Number((big >> 12n) & 1023n),
    sequence: Number(big & 4095n)
  }
}
