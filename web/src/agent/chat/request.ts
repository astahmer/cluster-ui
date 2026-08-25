// Vendored from emi-healthfit @emi/core (chat/request.ts), adapted to zod.
import { z } from "zod";
import { ChatMessageSchema } from "../protocol/messages.ts";

const nonEmptyText = z.string().min(1).regex(/\S/);

export const ChatModelConfigurationSchema = z.object({
  provider: nonEmptyText,
  baseUrl: z.optional(z.string()),
  apiKey: nonEmptyText,
  model: nonEmptyText,
  system: z.optional(z.string()),
});

export type ChatModelConfiguration = z.infer<typeof ChatModelConfigurationSchema>;

export const CompactConversationRequestSchema = z.object({
  config: ChatModelConfigurationSchema,
});

export const CompactedSummarySchema = z.object({
  content: nonEmptyText,
  sourceConversationId: nonEmptyText,
});
export type CompactedSummary = z.infer<typeof CompactedSummarySchema>;

export const ChatMemoryRequestSchema = z.object({
  enabled: z.optional(z.boolean()),
  model: z.optional(nonEmptyText),
});

export const ChatStreamRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
  system: z.optional(z.string()),
  config: ChatModelConfigurationSchema,
  title: z.optional(
    z.object({
      model: z.optional(nonEmptyText),
      prompt: z.optional(z.string()),
    }),
  ),
  memory: z.optional(ChatMemoryRequestSchema),
  temporary: z.optional(z.boolean()),
  sessionId: z.optional(z.string()),
  threadId: z.optional(z.string()),
  tokenBudget: z.optional(z.number().min(0)),
  replaceMessageId: z.optional(nonEmptyText),
  requestId: z.optional(z.string()),
  webSearch: z.optional(z.boolean()),
});

export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>;

const TextPart = z.object({ type: z.literal("text"), text: z.string() });
const AttachmentPart = z.union([
  z.object({
    type: z.literal("file"),
    data: z.optional(z.string()),
    url: z.optional(z.string()),
  }),
  z.object({ type: z.literal("image"), image: z.optional(z.string()) }),
  z.object({
    type: z.literal("file"),
    file: z.object({
      size: z.optional(z.number()),
      url: z.string(),
    }),
  }),
]);

export const maxAttachmentBytes = 25 * 1024 * 1024;
export const maxTotalAttachmentBytesPerMessage = 50 * 1024 * 1024;
const maxAttachmentsPerMessage = 10;

const firstZodMatch = <Value>(schema: z.ZodType<Value>, value: unknown): Value | undefined => {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
};

export const firstUserText = (
  messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<unknown> }>,
): string | undefined => {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      const textPart = firstZodMatch(TextPart, part);
      if (textPart !== undefined) return textPart.text.trim();
    }
  }
  return undefined;
};

const dataUrlPayloadBytes = (value: string): number => {
  const commaIndex = value.indexOf(",");
  const encoded = commaIndex === -1 ? value : value.slice(commaIndex + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
};

type AttachmentPartValue = z.infer<typeof AttachmentPart>;

const attachmentSize = (part: AttachmentPartValue): number => {
  if (part.type === "file" && "file" in part) {
    return (
      part.file.size ??
      (part.file.url.startsWith("data:")
        ? dataUrlPayloadBytes(part.file.url)
        : part.file.url.length)
    );
  }
  const value = part.type === "file" ? (part.data ?? part.url) : part.image;
  if (value === undefined) return 0;
  return value.startsWith("data:") ? dataUrlPayloadBytes(value) : value.length;
};

export const validateChatAttachments = (
  messages: ReadonlyArray<{ parts: ReadonlyArray<unknown> }>,
): string | undefined => {
  for (const message of messages) {
    const attachments = message.parts.flatMap((part) => {
      const attachment = firstZodMatch(AttachmentPart, part);
      return attachment !== undefined ? [attachment] : [];
    });
    if (attachments.length > maxAttachmentsPerMessage) {
      return `Too many attachments. Maximum ${maxAttachmentsPerMessage} per message.`;
    }
    if (attachments.some((attachment) => attachmentSize(attachment) > maxAttachmentBytes)) {
      return "One attachment is too large. Maximum size is 25 MB.";
    }
    if (
      attachments.reduce((total, attachment) => total + attachmentSize(attachment), 0) >
      maxTotalAttachmentBytesPerMessage
    ) {
      return "Attachments are too large in total. Maximum size is 50 MB per message.";
    }
  }
  return undefined;
};
