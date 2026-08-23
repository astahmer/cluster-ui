/** Server configuration from environment variables. */
export interface ClusterProfile {
  /** display name used in the UI switcher and `?cluster=` param */
  readonly name: string
  /** SQLite database file */
  readonly dbFile: string
  /** table prefix used when the cluster storages were created */
  readonly prefix: string
}

/**
 * Cluster registry: `CLUSTER_UI_CLUSTERS="name=path[:prefix],name2=path2[:prefix2]"`.
 * Falls back to a single cluster named "default" from CLUSTER_UI_DB/CLUSTER_UI_PREFIX.
 */
function parseClusters(): ReadonlyArray<ClusterProfile> {
  const raw = process.env.CLUSTER_UI_CLUSTERS
  if (!raw?.trim()) {
    const profile: ClusterProfile = {
      name: "default",
      dbFile: process.env.CLUSTER_UI_DB ?? "./data/cluster.db",
      prefix: process.env.CLUSTER_UI_PREFIX ?? "cluster"
    }
    return [profile]
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=")
      const name = eq === -1 ? entry : entry.slice(0, eq).trim()
      const rest = eq === -1 ? "" : entry.slice(eq + 1).trim()
      const colon = rest.lastIndexOf(":")
      // "path:prefix" only counts as a split when the part after ":" has no path separator
      const looksLikePrefix =
        colon !== -1 && !rest.slice(colon + 1).includes("/") && rest.slice(colon + 1).length > 0
      return {
        name: name || "default",
        dbFile: looksLikePrefix ? rest.slice(0, colon) : rest,
        prefix: looksLikePrefix ? rest.slice(colon + 1) : process.env.CLUSTER_UI_PREFIX ?? "cluster"
      }
    })
}

export const config = {
  clusters: parseClusters(),
  /** convenience accessors for the single-cluster case */
  get dbFile(): string {
    return this.clusters[0].dbFile
  },
  get prefix(): string {
    return this.clusters[0].prefix
  },
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  readonly: process.env.CLUSTER_UI_READONLY === "1",
  /** when set, /api/* requires this token (cookie or Authorization: Bearer) */
  authToken: process.env.CLUSTER_UI_TOKEN ?? null,
  /**
   * Deep-link template for an external tracing UI, e.g.
   * `CLUSTER_UI_TRACE_URL="http://jaeger.local/trace/{traceId}"`.
   * The literal `{traceId}` is replaced with the message's trace id.
   */
  tracingUrlTemplate: process.env.CLUSTER_UI_TRACE_URL?.includes("{traceId}")
    ? process.env.CLUSTER_UI_TRACE_URL
    : null
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
