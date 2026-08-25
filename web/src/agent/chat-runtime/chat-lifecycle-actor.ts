import { fromCallback, sendTo, setup } from "xstate";

import type { ChatMessage } from "../protocol/messages.ts";
import type { ChatRouteInput } from "../runtime/types.ts";
import type { ChatSession, ChatSessionEvent } from "../chat-session-machine.ts";
import type { ChatUiActorEvent } from "./chat-ui-actor.ts";
import type { ConversationStoreActorEvent } from "./conversation-store-actor.ts";
import type { ChatTransportActorEvent } from "./transport-types.ts";

export interface ChatLifecycleActorInput {
  readonly sendSession: (event: ChatSessionEvent) => void;
  readonly sendTransport: (event: ChatTransportActorEvent) => void;
  readonly sendConversationStore: (event: ConversationStoreActorEvent) => void;
  readonly sendChatUi: (event: ChatUiActorEvent) => void;
  readonly onSessionCreated?: (input: { readonly conversationId: string }) => void;
  readonly onHistoryChanged?: (input: {
    readonly conversationId: string;
    readonly signal: AbortSignal;
  }) => void | Promise<void>;
  readonly onStreamCompleted?: (input: {
    readonly conversationId: string;
    readonly message: ChatMessage;
    readonly temporary: boolean;
  }) => void | Promise<void>;
}

export type ChatLifecycleActorEvent =
  | { type: "route-sync-requested"; route: ChatRouteInput }
  | { type: "session-event"; event: ChatSessionEvent };

type LifecycleSession = Pick<
  ChatSession,
  | "conversationId"
  | "threadId"
  | "messages"
  | "streamMessageId"
  | "resumeMessageId"
  | "streamOrigin"
  | "streamOutcome"
  | "temporary"
>;

const initialLifecycleSession = (): LifecycleSession => ({
  conversationId: undefined,
  threadId: undefined,
  messages: [],
  streamMessageId: undefined,
  resumeMessageId: undefined,
  streamOrigin: undefined,
  streamOutcome: undefined,
  temporary: false,
});

const replaceMessage = ({
  messages,
  message,
  replacementId,
}: {
  messages: ChatMessage[];
  message: ChatMessage;
  replacementId: string | undefined;
}): ChatMessage[] => {
  const messageIndex = messages.findIndex((candidate) => candidate.id === message.id);
  const replacementIndex =
    messageIndex === -1 && replacementId !== undefined
      ? messages.findIndex((candidate) => candidate.id === replacementId)
      : messageIndex;
  if (replacementIndex === -1) return [...messages, message];
  return [...messages.slice(0, replacementIndex), message, ...messages.slice(replacementIndex + 1)];
};

const removeMessage = ({
  messages,
  messageId,
}: {
  messages: ChatMessage[];
  messageId: string | undefined;
}): ChatMessage[] =>
  messageId === undefined ? messages : messages.filter(({ id }) => id !== messageId);

const routeKey = ({ historyReady, sessionId, threadId, temporary }: ChatRouteInput): string =>
  `${historyReady ? "ready" : "waiting"}:${sessionId ?? "new"}:${threadId ?? "root"}:${temporary ? "temporary" : "persistent"}`;

const chatLifecycleOperations = fromCallback<ChatLifecycleActorEvent, ChatLifecycleActorInput>(
  ({ input, receive }) => {
    let route: ChatRouteInput = {
      historyReady: false,
      sessionId: undefined,
      threadId: undefined,
      temporary: false,
    };
    let session = initialLifecycleSession();
    let isStreaming = false;
    let appliedRouteKey: string | undefined;
    let notifiedConversationId: string | undefined;
    let historyKey: string | undefined;
    let historyController: AbortController | undefined;
    let historyScheduled = false;
    let completedStream: { conversationId: string; message: ChatMessage } | undefined;

    const abortHistory = () => {
      historyController?.abort();
      historyController = undefined;
    };

    const selectedConversation = () => {
      if (route.temporary || session.temporary) return false;
      if (session.conversationId === undefined) return false;
      return route.sessionId === undefined || route.sessionId === session.conversationId;
    };

    const syncHistory = () => {
      historyScheduled = false;
      if (!route.historyReady || !selectedConversation() || isStreaming) return;
      const conversationId = session.conversationId;
      if (conversationId === undefined) return;
      const nextHistoryKey = `${conversationId}:${session.messages
        .map((message) => `${message.id}:${message.parts.length}`)
        .join(",")}`;
      if (historyKey === nextHistoryKey) return;
      historyKey = nextHistoryKey;
      abortHistory();
      const controller = new AbortController();
      historyController = controller;
      void Promise.resolve(
        input.onHistoryChanged?.({ conversationId, signal: controller.signal }),
      ).catch(() => undefined);
    };

    const scheduleHistory = () => {
      if (historyScheduled) return;
      historyScheduled = true;
      queueMicrotask(syncHistory);
    };

    const resetForRoute = () => {
      input.sendTransport({ type: "stream-cancelled" });
      input.sendSession({ type: "temporary-changed", temporary: route.temporary });
      input.sendSession({ type: "fresh-started" });
      input.sendChatUi({ type: "queued-follow-up-edit-cleared" });
      input.sendConversationStore({ type: "threads-cleared" });
      session = { ...initialLifecycleSession(), temporary: route.temporary };
      completedStream = undefined;
      isStreaming = false;
      abortHistory();
      historyKey = undefined;
      notifiedConversationId = undefined;
    };

    const syncRoute = (nextRoute: ChatRouteInput) => {
      route = nextRoute;
      if (!route.historyReady) return;
      const nextRouteKey = routeKey(route);
      if (nextRouteKey === appliedRouteKey) return;
      appliedRouteKey = nextRouteKey;
      if (
        route.sessionId !== undefined &&
        !route.temporary &&
        session.conversationId === route.sessionId &&
        session.temporary === route.temporary
      ) {
        if (route.threadId !== undefined && session.threadId !== route.threadId)
          input.sendConversationStore({
            type: "thread-load-requested",
            conversationId: route.sessionId,
            threadId: route.threadId,
          });
        scheduleHistory();
        return;
      }
      resetForRoute();
      if (route.sessionId !== undefined && !route.temporary)
        input.sendConversationStore({
          type: "conversation-load-requested",
          conversationId: route.sessionId,
        });
    };

    const notifySessionCreated = () => {
      if (route.temporary || route.sessionId !== undefined) return;
      const conversationId = session.conversationId;
      if (conversationId === undefined || notifiedConversationId === conversationId) return;
      notifiedConversationId = conversationId;
      input.onSessionCreated?.({ conversationId });
    };

    const handleSessionEvent = (event: ChatSessionEvent) => {
      if (event.type === "temporary-changed") {
        session.temporary = event.temporary;
        return;
      }
      if (event.type === "conversation-compacted") {
        if (!route.temporary && !session.temporary) {
          if (route.threadId !== undefined && session.threadId === route.threadId) {
            input.sendConversationStore({
              type: "thread-load-requested",
              conversationId: event.conversationId,
              threadId: route.threadId,
            });
          } else {
            input.sendConversationStore({
              type: "conversation-load-requested",
              conversationId: event.conversationId,
            });
          }
        }
        return;
      }
      if (event.type === "fresh-started") {
        session = { ...initialLifecycleSession(), temporary: session.temporary };
        isStreaming = false;
        abortHistory();
        historyKey = undefined;
        notifiedConversationId = undefined;
        return;
      }
      if (event.type === "conversation-opened") {
        session = {
          ...initialLifecycleSession(),
          temporary: session.temporary,
          conversationId: event.conversationId,
          messages: [...event.messages],
        };
        isStreaming = false;
        scheduleHistory();
        return;
      }
      if (event.type === "thread-opened") {
        session = {
          ...initialLifecycleSession(),
          temporary: session.temporary,
          conversationId: session.conversationId,
          threadId: event.threadId,
          messages: [...event.messages],
        };
        isStreaming = false;
        scheduleHistory();
        return;
      }
      if (event.type === "conversation-identified") {
        session.conversationId = event.conversationId;
        notifySessionCreated();
        return;
      }
      if (event.type === "stream-started") {
        completedStream = undefined;
        session = {
          ...session,
          messages: removeMessage({
            messages: [...event.messages],
            messageId: session.streamMessageId,
          }),
          resumeMessageId: undefined,
          streamMessageId: undefined,
          streamOrigin: "send",
          streamOutcome: undefined,
        };
        isStreaming = true;
        return;
      }
      if (event.type === "stream-resumed") {
        completedStream = undefined;
        session = {
          ...session,
          resumeMessageId:
            session.messages.at(-1)?.role === "assistant" ? session.messages.at(-1)?.id : undefined,
          streamMessageId: undefined,
          streamOrigin: "resume",
          streamOutcome: undefined,
        };
        isStreaming = true;
        return;
      }
      if (event.type === "stream-message") {
        session = {
          ...session,
          messages: replaceMessage({
            messages: session.messages,
            message: event.message,
            replacementId: session.resumeMessageId,
          }),
          resumeMessageId: undefined,
          streamMessageId: event.message.id,
        };
        return;
      }
      if (event.type === "stream-completed") {
        session.streamOutcome = "completed";
        const message =
          session.conversationId === undefined
            ? undefined
            : session.messages.find((candidate) => candidate.id === session.streamMessageId);
        if (session.conversationId !== undefined && message !== undefined) {
          completedStream = { conversationId: session.conversationId, message };
        }
        return;
      }
      if (event.type === "stream-cancelled") {
        session.streamOutcome = "cancelled";
        return;
      }
      if (event.type === "error-reported") {
        session.streamOutcome = "failed";
        return;
      }
      if (event.type !== "stream-finished") return;
      isStreaming = false;
      session.resumeMessageId = undefined;
      const completed = completedStream;
      if (
        completed !== undefined ||
        (session.streamOrigin === "send" &&
          session.streamOutcome === "completed" &&
          session.conversationId !== undefined &&
          session.streamMessageId !== undefined)
      ) {
        const message =
          completed?.message ??
          session.messages.find(
            (candidate) =>
              candidate.id === session.streamMessageId && candidate.role === "assistant",
          );
        if (message !== undefined) {
          const conversationId = completed?.conversationId ?? session.conversationId;
          if (conversationId !== undefined) {
            void Promise.resolve(
              input.onStreamCompleted?.({
                conversationId,
                message,
                temporary: session.temporary,
              }),
            ).catch(() => undefined);
          }
        }
      }
      completedStream = undefined;
      scheduleHistory();
    };

    receive((event) => {
      if (event.type === "route-sync-requested") syncRoute(event.route);
      if (event.type === "session-event") handleSessionEvent(event.event);
    });

    return abortHistory;
  },
);

export const chatLifecycleActor = setup({
  types: {
    context: {} as ChatLifecycleActorInput,
    input: {} as ChatLifecycleActorInput,
    events: {} as ChatLifecycleActorEvent,
  },
  actors: { operations: chatLifecycleOperations },
  actions: {
    forwardEvent: sendTo("operations", ({ event }) => event),
  },
}).createMachine({
  id: "chatLifecycle",
  context: ({ input }) => input,
  invoke: { id: "operations", src: "operations", input: ({ context }) => context },
  on: {
    "route-sync-requested": { actions: "forwardEvent" },
    "session-event": { actions: "forwardEvent" },
  },
});
