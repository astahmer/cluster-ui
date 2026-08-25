// Vendored from emi-healthfit @emi/core (protocol/resources.ts), adapted to zod.
import { z } from "zod";
import {
  ConversationIdSchema,
  MemoryIdSchema,
  MessageIdSchema,
  ThreadIdSchema,
  TimestampSchema,
} from "./ids.ts";

const title = z.nullable(z.string());

const conversationFields = {
  id: ConversationIdSchema,
  title,
  status: z.enum(["regular", "archived"]),
  pinned: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const ConversationSchema = z.object(conversationFields);
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationDtoSchema = z.object(conversationFields);
export type ConversationDto = z.infer<typeof ConversationDtoSchema>;

const threadFields = {
  id: ThreadIdSchema,
  conversationId: ConversationIdSchema,
  anchorMessageId: MessageIdSchema,
  title,
  status: z.enum(["regular", "discarded", "merged"]),
  pinned: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const ThreadSchema = z.object(threadFields);
export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadDtoSchema = z.object(threadFields);
export type ThreadDto = z.infer<typeof ThreadDtoSchema>;

const memoryFields = {
  id: MemoryIdSchema,
  content: z.string().min(1).regex(/\S/),
  source: z.nullable(z.string()),
  threadId: z.nullable(ThreadIdSchema),
  createdAt: TimestampSchema,
  rank: z.number().min(0),
};

export const MemorySchema = z.object(memoryFields);
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryDtoSchema = z.object(memoryFields);
export type MemoryDto = z.infer<typeof MemoryDtoSchema>;

const memorySummaryFields = {
  content: z.string().min(1).regex(/\S/),
  memoryCount: z.number().int().min(0),
  updatedAt: TimestampSchema,
};

export const MemorySummarySchema = z.object(memorySummaryFields);
export type MemorySummary = z.infer<typeof MemorySummarySchema>;

export const MemorySummaryDtoSchema = z.object(memorySummaryFields);
export type MemorySummaryDto = z.infer<typeof MemorySummaryDtoSchema>;
