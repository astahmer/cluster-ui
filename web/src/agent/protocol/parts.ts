// Vendored from emi-healthfit @emi/core (protocol/parts.ts), adapted to zod.
// Part-type unions are load-bearing for the UI — do not rename or reorder.
import { z } from "zod";

import { AttachmentIdSchema, ToolCallIdSchema } from "./ids.ts";

const nonEmptyText = z.string().min(1).regex(/\S/);
const safeAttachmentUrl = z
  .string()
  .min(1)
  .regex(
    /^(?:https?:\/\/|\/(?!\/)|data:(?!(?:application\/(?:ecmascript|javascript|xhtml\+xml)|image\/svg\+xml|text\/(?:html|javascript))(?:;|,))[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[^,]*)?,)/i,
  );
const extensionNamespace = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i);
const extensionName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i);
const componentIdentifier = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

export const AttachmentSchema = z.object({
  id: AttachmentIdSchema,
  name: nonEmptyText,
  mediaType: nonEmptyText,
  url: safeAttachmentUrl,
  size: z.optional(z.number().int().min(0)),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const ToolCallSchema = z.object({
  id: ToolCallIdSchema,
  name: nonEmptyText,
  input: z.record(z.string(), z.json()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  callId: ToolCallIdSchema,
  output: z.json(),
  isError: z.optional(z.boolean()),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const TextMessagePartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextMessagePart = z.infer<typeof TextMessagePartSchema>;

export const ReasoningMessagePartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});
export type ReasoningMessagePart = z.infer<typeof ReasoningMessagePartSchema>;

export const FileMessagePartSchema = z.object({
  type: z.literal("file"),
  file: AttachmentSchema,
});
export type FileMessagePart = z.infer<typeof FileMessagePartSchema>;

export const ToolCallMessagePartSchema = z.object({
  type: z.literal("tool-call"),
  call: ToolCallSchema,
});
export type ToolCallMessagePart = z.infer<typeof ToolCallMessagePartSchema>;

export const ToolResultMessagePartSchema = z.object({
  type: z.literal("tool-result"),
  result: ToolResultSchema,
});
export type ToolResultMessagePart = z.infer<typeof ToolResultMessagePartSchema>;

export const ToolInvocationStateSchema = z.enum([
  "input-available",
  "output-available",
  "output-error",
]);
export type ToolInvocationState = z.infer<typeof ToolInvocationStateSchema>;

export const ToolInvocationMessagePartSchema = z.object({
  type: z.literal("tool-invocation"),
  toolName: nonEmptyText,
  toolCallId: ToolCallIdSchema,
  state: ToolInvocationStateSchema,
  input: z.json(),
  output: z.optional(z.json()),
  errorText: z.optional(z.string()),
});
export type ToolInvocationMessagePart = z.infer<typeof ToolInvocationMessagePartSchema>;

export const ExtensionPartSchema = z.object({
  type: z.literal("extension"),
  namespace: extensionNamespace,
  name: extensionName,
  data: z.json(),
});
export type ExtensionPart = z.infer<typeof ExtensionPartSchema>;

export const MessagePartSchema = z.union([
  TextMessagePartSchema,
  ReasoningMessagePartSchema,
  FileMessagePartSchema,
  ToolCallMessagePartSchema,
  ToolResultMessagePartSchema,
  ToolInvocationMessagePartSchema,
  // dadabase approval flow rides in extension parts (see chat/ui-messages.ts);
  // without this member every approval-requested tool call fails protocol decoding.
  ExtensionPartSchema,
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

export const DynamicComponentElementSchema = z.object({
  type: componentIdentifier,
  props: z.record(z.string(), z.json()),
  children: z.optional(z.array(componentIdentifier)),
  visible: z.optional(z.boolean()),
});
export type DynamicComponentElement = z.infer<typeof DynamicComponentElementSchema>;

export const DynamicComponentSpecSchema = z.object({
  root: componentIdentifier,
  elements: z.record(z.string(), DynamicComponentElementSchema),
});
export type DynamicComponentSpec = z.infer<typeof DynamicComponentSpecSchema>;

export const DynamicComponentEnvelopeSchema = z.object({
  spec: DynamicComponentSpecSchema,
});
export type DynamicComponentEnvelope = z.infer<typeof DynamicComponentEnvelopeSchema>;
