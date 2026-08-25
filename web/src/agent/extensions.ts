// Type-only stub vendored for the chat runtime (Phase A).
// Full extension machinery (@emi/core src/extensions.ts) was consciously not
// ported — nothing in dadabase defines chat extensions yet.

/** Validates one extension part payload. Returns the parsed value or undefined. */
export type PartDecoder = (value: unknown) => unknown;

export interface ChatExtensionDefinition {
  readonly id: string;
  readonly namespace?: string;
  readonly parts?: Readonly<Record<string, PartDecoder>>;
  readonly tools?: Readonly<Record<string, PartDecoder>>;
}

export interface ChatExtension {
  readonly id: string;
  readonly namespace: string;
  readonly parts: Readonly<Record<string, PartDecoder>>;
  readonly tools: Readonly<Record<string, PartDecoder>>;
}
