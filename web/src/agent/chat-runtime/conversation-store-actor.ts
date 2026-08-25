import { assign, fromCallback, sendTo, setup } from "xstate";

import type { ChatMessage } from "../protocol/messages.ts";
import type { MessagePart } from "../protocol/parts.ts";
import type { MemorySummary } from "../protocol/resources.ts";
import type { ChatSessionEvent } from "../chat-session-machine.ts";
import type { ChatTransportActorEvent, ChatTransportRequest } from "./transport-types.ts";
import type {
  Conversation,
  ConversationClient,
  ConversationThread,
  Memory,
} from "./conversation-client.ts";
import type { ChatUiActorEvent } from "./chat-ui-actor.ts";

export interface ConversationStoreLoading {
  conversations: boolean;
  conversation: boolean;
  threads: boolean;
  thread: boolean;
  memories: boolean;
  mutation: boolean;
}

export interface ConversationStoreContext {
  client: ConversationClient;
  sendSession: (event: ChatSessionEvent) => void;
  sendTransport: (event: ChatTransportActorEvent) => void;
  sendUi: (event: ChatUiActorEvent) => void;
  conversations: Conversation[];
  threads: ConversationThread[];
  memories: Memory[];
  memorySummary: MemorySummary | undefined;
  requestedConversationId: string | undefined;
  loading: ConversationStoreLoading;
  error: string | undefined;
}

export interface ConversationStoreActorInput {
  client: ConversationClient;
  sendSession: (event: ChatSessionEvent) => void;
  sendTransport: (event: ChatTransportActorEvent) => void;
  sendUi: (event: ChatUiActorEvent) => void;
}

type ConversationStoreOperation = keyof ConversationStoreLoading;
type ConversationStoreQuery = Exclude<ConversationStoreOperation, "mutation">;

export type ConversationStoreActorEvent =
  | { type: "conversations-load-requested"; search: string }
  | { type: "conversation-load-requested"; conversationId: string }
  | {
      type: "conversation-message-revision-requested";
      conversationId: string;
      messageId: string;
      parts: ReadonlyArray<MessagePart>;
      threadId?: string;
      request: ChatTransportRequest;
    }
  | { type: "threads-load-requested"; conversationId: string }
  | { type: "thread-load-requested"; conversationId: string; threadId: string }
  | {
      type: "conversation-update-requested";
      conversationId: string;
      patch: { title?: string; status?: "regular" | "archived"; pinned?: boolean };
    }
  | { type: "conversation-delete-requested"; conversationId: string; resetSession: boolean }
  | { type: "conversation-clone-requested"; conversationId: string }
  | {
      type: "conversation-compact-requested";
      conversationId: string;
      config: { provider: string; apiKey: string; baseUrl?: string; model: string };
    }
  | { type: "memory-load-requested"; search: string }
  | { type: "memory-create-requested"; content: string; search: string }
  | { type: "memory-delete-requested"; memoryId: string }
  | {
      type: "thread-create-requested";
      conversationId: string;
      anchorMessageId: string;
    }
  | { type: "threads-cleared" }
  | { type: "session-event"; event: ChatSessionEvent }
  | { type: "conversations-loaded"; conversations: Conversation[] }
  | { type: "conversation-loaded"; conversation: Conversation; messages: ChatMessage[] }
  | { type: "threads-loaded"; threads: ConversationThread[] }
  | { type: "thread-loaded"; thread: ConversationThread; messages: ChatMessage[] }
  | { type: "conversation-updated"; conversation: Conversation }
  | { type: "conversation-deleted"; conversationId: string; resetSession: boolean }
  | { type: "conversation-created"; conversation: Conversation }
  | { type: "memories-loaded"; memories: Memory[]; summary: MemorySummary | undefined }
  | { type: "memory-summary-update-requested"; content: string }
  | { type: "memory-summary-updated"; summary: MemorySummary }
  | { type: "memory-deleted"; memoryId: string }
  | { type: "mutation-finished" }
  | { type: "operation-failed"; operation: ConversationStoreOperation; error: string };

const initialLoading: ConversationStoreLoading = {
  conversations: true,
  conversation: false,
  threads: false,
  thread: false,
  memories: true,
  mutation: false,
};

const errorMessage = ({ cause, fallback }: { cause: unknown; fallback: string }): string =>
  cause instanceof Error ? cause.message : fallback;

const conversationStoreOperations = fromCallback<
  ConversationStoreActorEvent,
  ConversationStoreActorInput
>(({ input, receive, sendBack }) => {
  const reportFailure = ({
    cause,
    operation,
    fallback,
  }: {
    cause: unknown;
    operation: ConversationStoreOperation;
    fallback: string;
  }) => {
    sendBack({ type: "operation-failed", operation, error: errorMessage({ cause, fallback }) });
  };

  let nextQueryId = 0;
  const activeQueries = new Map<ConversationStoreQuery, number>();
  const beginQuery = ({ operation }: { operation: ConversationStoreQuery }): number => {
    nextQueryId += 1;
    activeQueries.set(operation, nextQueryId);
    return nextQueryId;
  };
  const isCurrentQuery = ({
    operation,
    queryId,
  }: {
    operation: ConversationStoreQuery;
    queryId: number;
  }): boolean => activeQueries.get(operation) === queryId;

  const loadConversations = async ({ search }: { search: string }) => {
    const queryId = beginQuery({ operation: "conversations" });
    try {
      const conversations = await input.client.listConversations({ search });
      if (!isCurrentQuery({ operation: "conversations", queryId })) return;
      sendBack({
        type: "conversations-loaded",
        conversations,
      });
    } catch (cause) {
      if (!isCurrentQuery({ operation: "conversations", queryId })) return;
      reportFailure({
        cause,
        operation: "conversations",
        fallback: "Unable to load conversations.",
      });
    }
  };

  const loadConversation = async ({ conversationId }: { conversationId: string }) => {
    const queryId = beginQuery({ operation: "conversation" });
    try {
      const loaded = await input.client.loadConversation({ conversationId });
      if (!isCurrentQuery({ operation: "conversation", queryId })) return;
      sendBack({ type: "conversation-loaded", ...loaded });
      input.sendTransport({
        type: "stream-resume-requested",
        conversationId: loaded.conversation.id,
      });
      void loadThreads({ conversationId: loaded.conversation.id });
    } catch (cause) {
      if (!isCurrentQuery({ operation: "conversation", queryId })) return;
      reportFailure({
        cause,
        operation: "conversation",
        fallback: "Unable to load this conversation.",
      });
    }
  };

  const reviseConversationMessage = async (
    event: Extract<
      ConversationStoreActorEvent,
      { type: "conversation-message-revision-requested" }
    >,
  ) => {
    try {
      await input.client.reviseConversationMessage({
        conversationId: event.conversationId,
        messageId: event.messageId,
        parts: event.parts,
        ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
      });
      sendBack({ type: "mutation-finished" });
      input.sendTransport({ type: "stream-send-requested", request: event.request });
    } catch (cause) {
      reportFailure({
        cause,
        operation: "mutation",
        fallback: "Unable to save this message revision.",
      });
    }
  };

  const loadThreads = async ({ conversationId }: { conversationId: string }) => {
    const queryId = beginQuery({ operation: "threads" });
    try {
      const threads = await input.client.listThreads({ conversationId });
      if (!isCurrentQuery({ operation: "threads", queryId })) return;
      sendBack({
        type: "threads-loaded",
        threads,
      });
    } catch (cause) {
      if (!isCurrentQuery({ operation: "threads", queryId })) return;
      reportFailure({
        cause,
        operation: "threads",
        fallback: "Unable to load conversation branches.",
      });
    }
  };

  const loadThread = async ({
    conversationId,
    threadId,
  }: {
    conversationId: string;
    threadId: string;
  }) => {
    const queryId = beginQuery({ operation: "thread" });
    try {
      const loaded = await input.client.loadThread({ conversationId, threadId });
      if (!isCurrentQuery({ operation: "thread", queryId })) return;
      sendBack({
        type: "thread-loaded",
        ...loaded,
      });
    } catch (cause) {
      if (!isCurrentQuery({ operation: "thread", queryId })) return;
      reportFailure({ cause, operation: "thread", fallback: "Unable to load this branch." });
    }
  };

  const loadMemories = async ({ search }: { search: string }) => {
    const queryId = beginQuery({ operation: "memories" });
    try {
      const [memories, summary] = await Promise.all([
        input.client.listMemories({ search }),
        input.client.loadMemorySummary(),
      ]);
      if (!isCurrentQuery({ operation: "memories", queryId })) return;
      input.sendUi({ type: "memory-summary-loaded", content: summary?.content });
      sendBack({ type: "memories-loaded", memories, summary });
    } catch (cause) {
      if (!isCurrentQuery({ operation: "memories", queryId })) return;
      reportFailure({ cause, operation: "memories", fallback: "Unable to load memories." });
    }
  };

  receive((event) => {
    if (event.type === "conversations-load-requested")
      void loadConversations({ search: event.search });
    if (event.type === "conversation-load-requested")
      void loadConversation({ conversationId: event.conversationId });
    if (event.type === "conversation-message-revision-requested")
      void reviseConversationMessage(event);
    if (event.type === "threads-load-requested")
      void loadThreads({ conversationId: event.conversationId });
    if (event.type === "thread-load-requested") void loadThread(event);
    if (event.type === "memory-load-requested") void loadMemories({ search: event.search });
    if (event.type === "session-event" && event.event.type === "conversation-identified") {
      void loadConversations({ search: "" });
      void loadThreads({ conversationId: event.event.conversationId });
    }
    if (event.type === "conversation-update-requested") {
      void input.client
        .updateConversation({ conversationId: event.conversationId, patch: event.patch })
        .then(
          (conversation) => sendBack({ type: "conversation-updated", conversation }),
          (cause: unknown) =>
            reportFailure({
              cause,
              operation: "mutation",
              fallback: "Unable to update this conversation.",
            }),
        );
    }
    if (event.type === "conversation-delete-requested") {
      void input.client.deleteConversation({ conversationId: event.conversationId }).then(
        () =>
          sendBack({
            type: "conversation-deleted",
            conversationId: event.conversationId,
            resetSession: event.resetSession,
          }),
        (cause: unknown) =>
          reportFailure({
            cause,
            operation: "mutation",
            fallback: "Unable to delete this conversation.",
          }),
      );
    }
    if (event.type === "conversation-clone-requested") {
      void input.client.cloneConversation({ conversationId: event.conversationId }).then(
        async (conversation) => {
          sendBack({ type: "conversation-created", conversation });
          await loadConversation({ conversationId: conversation.id });
        },
        (cause: unknown) =>
          reportFailure({
            cause,
            operation: "mutation",
            fallback: "Unable to clone this conversation.",
          }),
      );
    }
    if (event.type === "conversation-compact-requested") {
      void input.client
        .compactConversation({ conversationId: event.conversationId, config: event.config })
        .then(
          async (conversation) => {
            sendBack({ type: "conversation-created", conversation });
            await loadConversation({ conversationId: conversation.id });
          },
          (cause: unknown) =>
            reportFailure({
              cause,
              operation: "mutation",
              fallback: "Unable to compact this conversation.",
            }),
        );
    }
    if (event.type === "memory-create-requested") {
      void input.client.createMemory({ content: event.content }).then(
        async () => {
          sendBack({ type: "mutation-finished" });
          await loadMemories({ search: event.search });
        },
        (cause: unknown) =>
          reportFailure({ cause, operation: "mutation", fallback: "Unable to save this memory." }),
      );
    }
    if (event.type === "memory-delete-requested") {
      void input.client.deleteMemory({ memoryId: event.memoryId }).then(
        () => sendBack({ type: "memory-deleted", memoryId: event.memoryId }),
        (cause: unknown) =>
          reportFailure({
            cause,
            operation: "mutation",
            fallback: "Unable to delete this memory.",
          }),
      );
    }
    if (event.type === "memory-summary-update-requested") {
      void input.client.updateMemorySummary({ content: event.content }).then(
        (summary) => {
          input.sendUi({ type: "memory-summary-saved", content: summary.content });
          sendBack({ type: "memory-summary-updated", summary });
        },
        (cause: unknown) =>
          reportFailure({
            cause,
            operation: "mutation",
            fallback: "Unable to update the memory summary.",
          }),
      );
    }
    if (event.type === "thread-create-requested") {
      void input.client
        .createThread({
          conversationId: event.conversationId,
          anchorMessageId: event.anchorMessageId,
        })
        .then(
          async (thread) => {
            sendBack({ type: "mutation-finished" });
            await loadThreads({ conversationId: event.conversationId });
            await loadThread({ conversationId: event.conversationId, threadId: thread.id });
          },
          (cause: unknown) =>
            reportFailure({
              cause,
              operation: "mutation",
              fallback: "Unable to create this branch.",
            }),
        );
    }
  });
});

const loading = ({
  context,
  operation,
  value,
}: {
  context: ConversationStoreContext;
  operation: ConversationStoreOperation;
  value: boolean;
}): ConversationStoreLoading => ({ ...context.loading, [operation]: value });

export const conversationStoreActor = setup({
  types: {
    context: {} as ConversationStoreContext,
    input: {} as ConversationStoreActorInput,
    events: {} as ConversationStoreActorEvent,
  },
  actors: { operations: conversationStoreOperations },
  actions: {
    requestConversations: assign(({ context }) => ({
      loading: loading({ context, operation: "conversations", value: true }),
      error: undefined,
    })),
    requestConversation: assign(({ context, event }) => ({
      loading: loading({ context, operation: "conversation", value: true }),
      error: undefined,
      requestedConversationId:
        event.type === "conversation-load-requested"
          ? event.conversationId
          : context.requestedConversationId,
    })),
    requestThreads: assign(({ context }) => ({
      loading: loading({ context, operation: "threads", value: true }),
      error: undefined,
    })),
    requestThread: assign(({ context }) => ({
      loading: loading({ context, operation: "thread", value: true }),
      error: undefined,
    })),
    requestMemories: assign(({ context }) => ({
      loading: loading({ context, operation: "memories", value: true }),
      error: undefined,
    })),
    requestMutation: assign(({ context }) => ({
      loading: loading({ context, operation: "mutation", value: true }),
      error: undefined,
    })),
    receiveConversations: assign(({ context, event }) =>
      event.type === "conversations-loaded"
        ? {
            conversations: event.conversations,
            loading: loading({ context, operation: "conversations", value: false }),
          }
        : {},
    ),
    receiveConversation: assign(({ context, event }) =>
      event.type === "conversation-loaded"
        ? { loading: loading({ context, operation: "conversation", value: false }) }
        : {},
    ),
    receiveThreads: assign(({ context, event }) =>
      event.type === "threads-loaded"
        ? {
            threads: event.threads,
            loading: loading({ context, operation: "threads", value: false }),
          }
        : {},
    ),
    receiveThread: assign(({ context, event }) =>
      event.type === "thread-loaded"
        ? { loading: loading({ context, operation: "thread", value: false }) }
        : {},
    ),
    receiveConversationUpdate: assign(({ context, event }) =>
      event.type === "conversation-updated"
        ? {
            conversations: context.conversations.map((conversation) =>
              conversation.id === event.conversation.id ? event.conversation : conversation,
            ),
            loading: loading({ context, operation: "mutation", value: false }),
          }
        : {},
    ),
    receiveConversationDelete: assign(({ context, event }) =>
      event.type === "conversation-deleted"
        ? {
            conversations: context.conversations.filter(
              (conversation) => conversation.id !== event.conversationId,
            ),
            threads: event.resetSession ? [] : context.threads,
            loading: loading({ context, operation: "mutation", value: false }),
          }
        : {},
    ),
    receiveConversationCreate: assign(({ context, event }) =>
      event.type === "conversation-created"
        ? {
            conversations: [
              event.conversation,
              ...context.conversations.filter((item) => item.id !== event.conversation.id),
            ],
            loading: loading({ context, operation: "mutation", value: false }),
          }
        : {},
    ),
    receiveMemories: assign(({ context, event }) =>
      event.type === "memories-loaded"
        ? {
            memories: event.memories,
            memorySummary: event.summary,
            loading: loading({ context, operation: "memories", value: false }),
          }
        : {},
    ),
    receiveMemorySummary: assign(({ context, event }) =>
      event.type === "memory-summary-updated"
        ? {
            memorySummary: event.summary,
            loading: loading({ context, operation: "mutation", value: false }),
          }
        : {},
    ),
    receiveMemoryDelete: assign(({ context, event }) =>
      event.type === "memory-deleted"
        ? {
            memories: context.memories.filter((memory) => memory.id !== event.memoryId),
            loading: loading({ context, operation: "mutation", value: false }),
          }
        : {},
    ),
    finishMutation: assign(({ context }) => ({
      loading: loading({ context, operation: "mutation", value: false }),
    })),
    clearThreads: assign({
      threads: () => [],
      requestedConversationId: () => undefined,
    }),
    reportFailure: assign(({ context, event }) =>
      event.type === "operation-failed"
        ? {
            error: event.error,
            loading: loading({ context, operation: event.operation, value: false }),
          }
        : {},
    ),
    reportSessionFailure: ({ context, event }) => {
      if (event.type === "operation-failed")
        context.sendSession({ type: "error-reported", error: event.error });
    },
    openConversation: ({ context, event }) => {
      if (
        event.type === "conversation-loaded" &&
        event.conversation.id === context.requestedConversationId
      ) {
        context.sendSession({
          type: "conversation-opened",
          conversationId: event.conversation.id,
          messages: event.messages,
        });
      }
    },
    openThread: ({ context, event }) => {
      if (event.type === "thread-loaded")
        context.sendSession({
          type: "thread-opened",
          threadId: event.thread.id,
          messages: event.messages,
        });
    },
    resetSession: ({ context, event }) => {
      if (event.type === "conversation-deleted" && event.resetSession)
        context.sendSession({ type: "fresh-started" });
    },
    loadInitialConversations: sendTo("operations", {
      type: "conversations-load-requested",
      search: "",
    }),
    loadInitialMemories: sendTo("operations", { type: "memory-load-requested", search: "" }),
    forwardOperation: sendTo("operations", ({ event }) => event),
  },
}).createMachine({
  id: "conversationStore",
  context: ({ input }) => ({
    client: input.client,
    sendSession: input.sendSession,
    sendTransport: input.sendTransport,
    sendUi: input.sendUi,
    conversations: [],
    threads: [],
    memories: [],
    memorySummary: undefined,
    requestedConversationId: undefined,
    loading: initialLoading,
    error: undefined,
  }),
  invoke: {
    id: "operations",
    src: "operations",
    input: ({ context }) => ({
      client: context.client,
      sendSession: context.sendSession,
      sendTransport: context.sendTransport,
      sendUi: context.sendUi,
    }),
  },
  entry: ["loadInitialConversations", "loadInitialMemories"],
  on: {
    "conversations-load-requested": { actions: ["requestConversations", "forwardOperation"] },
    "conversation-load-requested": { actions: ["requestConversation", "forwardOperation"] },
    "conversation-message-revision-requested": { actions: ["requestMutation", "forwardOperation"] },
    "threads-load-requested": { actions: ["requestThreads", "forwardOperation"] },
    "thread-load-requested": { actions: ["requestThread", "forwardOperation"] },
    "memory-load-requested": { actions: ["requestMemories", "forwardOperation"] },
    "conversation-update-requested": { actions: ["requestMutation", "forwardOperation"] },
    "conversation-delete-requested": { actions: ["requestMutation", "forwardOperation"] },
    "conversation-clone-requested": { actions: ["requestMutation", "forwardOperation"] },
    "conversation-compact-requested": { actions: ["requestMutation", "forwardOperation"] },
    "memory-create-requested": { actions: ["requestMutation", "forwardOperation"] },
    "memory-delete-requested": { actions: ["requestMutation", "forwardOperation"] },
    "memory-summary-update-requested": { actions: ["requestMutation", "forwardOperation"] },
    "thread-create-requested": { actions: ["requestMutation", "forwardOperation"] },
    "threads-cleared": { actions: "clearThreads" },
    "session-event": { actions: "forwardOperation" },
    "conversations-loaded": { actions: "receiveConversations" },
    "conversation-loaded": { actions: ["receiveConversation", "openConversation"] },
    "threads-loaded": { actions: "receiveThreads" },
    "thread-loaded": { actions: ["receiveThread", "openThread"] },
    "conversation-updated": { actions: "receiveConversationUpdate" },
    "conversation-deleted": { actions: ["receiveConversationDelete", "resetSession"] },
    "conversation-created": { actions: "receiveConversationCreate" },
    "memories-loaded": { actions: "receiveMemories" },
    "memory-summary-updated": { actions: "receiveMemorySummary" },
    "memory-deleted": { actions: "receiveMemoryDelete" },
    "mutation-finished": { actions: "finishMutation" },
    "operation-failed": { actions: ["reportFailure", "reportSessionFailure"] },
  },
});
