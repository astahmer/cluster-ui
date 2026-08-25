import * as Effect from "effect/Effect";
import { z } from "zod";

import type { ChatModelConfiguration } from "../chat/request.ts";
import { collapseCompactedMessages } from "../chat/message-collapse.ts";
import { ChatProtocol } from "../protocol/mappers.ts";
import type { ChatMessage } from "../protocol/messages.ts";
import type { MessagePart } from "../protocol/parts.ts";
import { MessagePartSchema } from "../protocol/parts.ts";
import type { MemorySummary } from "../protocol/resources.ts";

const ConversationSchema = z.object({
  id: z.string(),
  title: z.nullable(z.string()),
  status: z.enum(["regular", "archived"]),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ConversationListSchema = z.object({ conversations: z.array(ConversationSchema) });
const ConversationMessageSchema = z.object({
  id: z.string(),
  parentId: z.optional(z.nullable(z.string())),
  role: ChatProtocol.schemas.messageRole,
  parts: z.string(),
  model: z.nullable(z.string()),
  createdAt: ChatProtocol.schemas.timestamp,
});
const ConversationMessagesSchema = z.array(ConversationMessageSchema);
const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: ConversationMessagesSchema,
});
const ThreadSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  anchorMessageId: z.string(),
  title: z.nullable(z.string()),
  status: z.enum(["regular", "discarded", "merged"]),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ThreadListSchema = z.object({ threads: z.array(ThreadSchema) });
const ThreadDetailSchema = z.object({
  thread: ThreadSchema,
  messages: ConversationMessagesSchema,
});
const MemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  source: z.nullable(z.string()),
  threadId: z.nullable(z.string()),
  createdAt: z.string(),
  deleted: z.boolean(),
  rank: z.number(),
});
const MemoryListSchema = z.object({ memories: z.array(MemorySchema) });
const MemorySummaryResponseSchema = z.object({
  summary: z.nullable(ChatProtocol.schemas.memorySummary),
});
const SuggestionsResponseSchema = z.object({ suggestions: z.array(z.string()) });
const ConversationResponseSchema = z.object({ conversation: ConversationSchema });
const DeletedResponseSchema = z.object({ deleted: z.literal(true) });
const RevisedResponseSchema = z.object({ ok: z.literal(true) });

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationThread = z.infer<typeof ThreadSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export interface SuggestionsRequest {
  readonly threadId?: string;
  readonly messageId?: string;
  readonly lastAssistantText: string;
  readonly lastUserText?: string;
  readonly config: ChatModelConfiguration;
}

type ConversationMessageValue = z.infer<typeof ConversationMessageSchema>;

const isJsonContentType = ({ response }: { response: Response }): boolean => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType === "" || contentType.includes("application/json") || contentType.includes("+json")
  );
};

const htmlResponseError =
  "API endpoint returned HTML instead of JSON. Check the Vite proxy and VITE_API_ORIGIN.";

const invalidJsonResponseError =
  "API endpoint returned invalid JSON. Check the Vite proxy and VITE_API_ORIGIN.";

const pathSegment = (value: string): string => encodeURIComponent(value);

const decodeSync = <Value>(schema: z.ZodType<Value>, payload: unknown): Value => {
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error(invalidJsonResponseError);
  return result.data;
};

const decodeMessages = async (
  values: ReadonlyArray<ConversationMessageValue>,
): Promise<ChatMessage[]> => {
  const collapsed = collapseCompactedMessages(values);
  const decoded = await Promise.all(
    collapsed.map(async (message): Promise<ChatMessage | undefined> => {
      try {
        let parts: Array<MessagePart>;
        try {
          const parsed = MessagePartSchema.array().safeParse(JSON.parse(message.parts));
          if (!parsed.success) return undefined;
          parts = parsed.data;
        } catch {
          return undefined;
        }
        return await Effect.runPromise(
          ChatProtocol.fromChatMessageDto({
            id: message.id,
            role: message.role,
            parts,
            createdAt: message.createdAt,
            ...(message.model === null ? {} : { model: message.model }),
          }),
        );
      } catch {
        return undefined;
      }
    }),
  );
  return decoded.filter((message): message is ChatMessage => message !== undefined);
};

export interface ConversationClient {
  listConversations(input: { search: string }): Promise<Conversation[]>;
  loadConversation(input: {
    conversationId: string;
  }): Promise<{ conversation: Conversation; messages: ChatMessage[] }>;
  reviseConversationMessage(input: {
    conversationId: string;
    messageId: string;
    parts: ReadonlyArray<MessagePart>;
    threadId?: string;
  }): Promise<void>;
  updateConversation(input: {
    conversationId: string;
    patch: { title?: string; status?: "regular" | "archived"; pinned?: boolean };
  }): Promise<Conversation>;
  deleteConversation(input: { conversationId: string }): Promise<void>;
  cloneConversation(input: { conversationId: string }): Promise<Conversation>;
  compactConversation(input: {
    conversationId: string;
    config: { provider: string; apiKey: string; baseUrl?: string; model: string };
  }): Promise<Conversation>;
  listMemories(input: { search: string }): Promise<Memory[]>;
  loadMemorySummary(): Promise<MemorySummary | undefined>;
  updateMemorySummary(input: { content: string }): Promise<MemorySummary>;
  createMemory(input: { content: string }): Promise<string>;
  deleteMemory(input: { memoryId: string }): Promise<void>;
  generateSuggestions(input: SuggestionsRequest): Promise<string[]>;
  listThreads(input: { conversationId: string }): Promise<ConversationThread[]>;
  createThread(input: {
    conversationId: string;
    anchorMessageId: string;
  }): Promise<ConversationThread>;
  loadThread(input: {
    conversationId: string;
    threadId: string;
  }): Promise<{ thread: ConversationThread; messages: ChatMessage[] }>;
}

export const createConversationClient = ({
  apiOrigin,
  fetch,
}: {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
}) => {
  const normalizedApiOrigin = apiOrigin.endsWith("/") ? apiOrigin.slice(0, -1) : apiOrigin;
  const apiUrl = (path: string): string => `${normalizedApiOrigin}${path}`;

  const readResponse = async ({ response }: { response: Response }): Promise<unknown> => {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) throw new Error(htmlResponseError);
    if (!isJsonContentType({ response })) {
      throw new Error(
        `API endpoint returned unexpected content type ${contentType || "unknown"}. Check the Vite proxy and VITE_API_ORIGIN.`,
      );
    }

    const body = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(
        body.trimStart().toLowerCase().startsWith("<!doctype")
          ? htmlResponseError
          : invalidJsonResponseError,
      );
    }
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload);
      throw new Error(
        error.success ? error.data.error : `Request failed (${response.status}).`,
      );
    }
    return payload;
  };

  const listConversations = async ({ search }: { search: string }): Promise<Conversation[]> => {
    const parameters = new URLSearchParams(search === "" ? {} : { search });
    const response = await fetch(apiUrl(`/api/conversations?${parameters.toString()}`));
    const payload = await readResponse({ response });
    const decoded = decodeSync(ConversationListSchema, payload);
    return [...decoded.conversations];
  };

  const loadConversation = async ({
    conversationId,
  }: {
    conversationId: string;
  }): Promise<{ conversation: Conversation; messages: ChatMessage[] }> => {
    const response = await fetch(apiUrl(`/api/conversations/${pathSegment(conversationId)}`));
    const payload = await readResponse({ response });
    const decoded = decodeSync(ConversationDetailSchema, payload);
    const messages = await decodeMessages(decoded.messages);
    return { conversation: decoded.conversation, messages };
  };

  const updateConversation = async ({
    conversationId,
    patch,
  }: {
    conversationId: string;
    patch: { title?: string; status?: "regular" | "archived"; pinned?: boolean };
  }): Promise<Conversation> => {
    const response = await fetch(apiUrl(`/api/conversations/${pathSegment(conversationId)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await readResponse({ response });
    const decoded = decodeSync(ConversationResponseSchema, payload);
    return decoded.conversation;
  };

  const reviseConversationMessage = async ({
    conversationId,
    messageId,
    parts,
    threadId,
  }: {
    conversationId: string;
    messageId: string;
    parts: ReadonlyArray<MessagePart>;
    threadId?: string;
  }): Promise<void> => {
    const response = await fetch(
      apiUrl(
        `/api/conversations/${pathSegment(conversationId)}/messages/${pathSegment(messageId)}`,
      ),
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parts: [...parts],
          ...(threadId === undefined ? {} : { threadId }),
        }),
      },
    );
    const payload = await readResponse({ response });
    decodeSync(RevisedResponseSchema, payload);
  };

  const deleteConversation = async ({
    conversationId,
  }: {
    conversationId: string;
  }): Promise<void> => {
    const response = await fetch(apiUrl(`/api/conversations/${pathSegment(conversationId)}`), {
      method: "DELETE",
    });
    const payload = await readResponse({ response });
    decodeSync(DeletedResponseSchema, payload);
  };

  const cloneConversation = async ({
    conversationId,
  }: {
    conversationId: string;
  }): Promise<Conversation> => {
    const response = await fetch(
      apiUrl(`/api/conversations/${pathSegment(conversationId)}/clone`),
      {
        method: "POST",
      },
    );
    const payload = await readResponse({ response });
    const decoded = decodeSync(ConversationResponseSchema, payload);
    return decoded.conversation;
  };

  const compactConversation = async ({
    conversationId,
    config,
  }: {
    conversationId: string;
    config: { provider: string; apiKey: string; baseUrl?: string; model: string };
  }): Promise<Conversation> => {
    const response = await fetch(
      apiUrl(`/api/conversations/${pathSegment(conversationId)}/compact`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
      },
    );
    const payload = await readResponse({ response });
    return decodeSync(ConversationResponseSchema, payload).conversation;
  };

  const listMemories = async ({ search }: { search: string }): Promise<Memory[]> => {
    const parameters = new URLSearchParams(search === "" ? {} : { search });
    const response = await fetch(apiUrl(`/api/memories?${parameters.toString()}`));
    const payload = await readResponse({ response });
    return [...decodeSync(MemoryListSchema, payload).memories];
  };

  const loadMemorySummary = async (): Promise<MemorySummary | undefined> => {
    const response = await fetch(apiUrl("/api/memories/summary"));
    const payload = await readResponse({ response });
    return decodeSync(MemorySummaryResponseSchema, payload).summary ?? undefined;
  };

  const updateMemorySummary = async ({ content }: { content: string }): Promise<MemorySummary> => {
    const response = await fetch(apiUrl("/api/memories/summary"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const payload = await readResponse({ response });
    return decodeSync(z.object({ summary: ChatProtocol.schemas.memorySummary }), payload).summary;
  };

  const createMemory = async ({ content }: { content: string }): Promise<string> => {
    const response = await fetch(apiUrl("/api/memories"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const payload = await readResponse({ response });
    return decodeSync(z.object({ id: z.string() }), payload).id;
  };

  const deleteMemory = async ({ memoryId }: { memoryId: string }): Promise<void> => {
    const response = await fetch(apiUrl(`/api/memories/${pathSegment(memoryId)}`), {
      method: "DELETE",
    });
    const payload = await readResponse({ response });
    decodeSync(DeletedResponseSchema, payload);
  };

  const generateSuggestions = async (input: SuggestionsRequest): Promise<string[]> => {
    const response = await fetch(apiUrl("/api/suggestions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await readResponse({ response });
    return [...decodeSync(SuggestionsResponseSchema, payload).suggestions];
  };

  const listThreads = async ({
    conversationId,
  }: {
    conversationId: string;
  }): Promise<ConversationThread[]> => {
    const response = await fetch(
      apiUrl(`/api/conversations/${pathSegment(conversationId)}/threads`),
    );
    const payload = await readResponse({ response });
    return [...decodeSync(ThreadListSchema, payload).threads];
  };

  const createThread = async ({
    conversationId,
    anchorMessageId,
  }: {
    conversationId: string;
    anchorMessageId: string;
  }): Promise<ConversationThread> => {
    const response = await fetch(
      apiUrl(`/api/conversations/${pathSegment(conversationId)}/threads`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anchorMessageId }),
      },
    );
    const payload = await readResponse({ response });
    return decodeSync(z.object({ thread: ThreadSchema }), payload).thread;
  };

  const loadThread = async ({
    conversationId,
    threadId,
  }: {
    conversationId: string;
    threadId: string;
  }): Promise<{ thread: ConversationThread; messages: ChatMessage[] }> => {
    const response = await fetch(
      apiUrl(`/api/conversations/${pathSegment(conversationId)}/threads/${pathSegment(threadId)}`),
    );
    const payload = await readResponse({ response });
    const decoded = decodeSync(ThreadDetailSchema, payload);
    return { thread: decoded.thread, messages: await decodeMessages(decoded.messages) };
  };

  return {
    listConversations,
    loadConversation,
    reviseConversationMessage,
    updateConversation,
    deleteConversation,
    cloneConversation,
    compactConversation,
    listMemories,
    loadMemorySummary,
    updateMemorySummary,
    createMemory,
    deleteMemory,
    generateSuggestions,
    listThreads,
    createThread,
    loadThread,
  } satisfies ConversationClient;
};
