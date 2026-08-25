// Vendored from emi-healthfit @emi/core (protocol/ids.ts), adapted to zod.
import { z } from "zod";

const identifier = z.string().min(1).regex(/^\S+$/);

export const ConversationIdSchema = identifier;
export type ConversationId = z.infer<typeof ConversationIdSchema>;

export const MessageIdSchema = identifier;
export type MessageId = z.infer<typeof MessageIdSchema>;

export const AttachmentIdSchema = identifier;
export type AttachmentId = z.infer<typeof AttachmentIdSchema>;

export const ToolCallIdSchema = identifier;
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;

export const ThreadIdSchema = identifier;
export type ThreadId = z.infer<typeof ThreadIdSchema>;

export const MemoryIdSchema = identifier;
export type MemoryId = z.infer<typeof MemoryIdSchema>;

export const GenerationIdSchema = identifier;
export type GenerationId = z.infer<typeof GenerationIdSchema>;

export const TimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
export type Timestamp = z.infer<typeof TimestampSchema>;
