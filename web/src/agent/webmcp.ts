// Type-only stub — cluster-ui does not use the webmcp host. Keeps runtime/types.ts
// compiling without vendoring dadabase's webmcp machinery.
export interface WebMcpModelContext {
  tools?: ReadonlyArray<unknown>
}
