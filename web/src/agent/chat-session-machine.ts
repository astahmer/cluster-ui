import { assign, setup } from "xstate";
import type { ChatMessage } from "./protocol/messages.ts";
import type { Attachment } from "./protocol/parts.ts";

export interface QueuedFollowUp {
  id: string;
  text: string;
  files: Attachment[];
}

export interface ChatSession {
  conversationId: string | undefined;
  threadId: string | undefined;
  messages: ChatMessage[];
  resumeMessageId: string | undefined;
  streamMessageId: string | undefined;
  failedStreamMessageId: string | undefined;
  streamOrigin: "send" | "resume" | undefined;
  streamOutcome: "completed" | "failed" | "cancelled" | undefined;
  sendPending: boolean;
  sendGrace: boolean;
  draft: string;
  files: Attachment[];
  temporary: boolean;
  error: string | undefined;
  errorMessageId: string | undefined;
  queuedFollowUps: QueuedFollowUp[];
}

export type ChatSessionEvent =
  | { type: "draft-changed"; draft: string }
  | { type: "files-changed"; files: Attachment[] }
  | { type: "files-added"; files: Attachment[] }
  | { type: "temporary-changed"; temporary: boolean }
  | { type: "fresh-started" }
  | { type: "conversation-opened"; conversationId: string; messages: ChatMessage[] }
  | { type: "thread-opened"; threadId: string; messages: ChatMessage[] }
  | { type: "conversation-identified"; conversationId: string }
  | { type: "conversation-compacted"; conversationId: string }
  | { type: "send-pending" }
  | { type: "stream-started"; messages: ChatMessage[] }
  | { type: "stream-resumed" }
  | { type: "stream-message"; message: ChatMessage }
  | { type: "stream-completed" }
  | { type: "stream-cancelled" }
  | { type: "stream-finished" }
  | { type: "error-reported"; error: string; messageId?: string }
  | { type: "error-cleared" }
  | { type: "follow-up-queued"; followUp: QueuedFollowUp }
  | { type: "queued-follow-up-forced"; id: string }
  | { type: "queued-follow-up-updated"; id: string; text: string; files: Attachment[] }
  | { type: "queued-follow-up-removed"; id: string }
  | { type: "queued-follow-ups-replaced"; items: QueuedFollowUp[] };

export const initialChatSession: ChatSession = {
  conversationId: undefined,
  threadId: undefined,
  messages: [],
  resumeMessageId: undefined,
  streamMessageId: undefined,
  failedStreamMessageId: undefined,
  streamOrigin: undefined,
  streamOutcome: undefined,
  sendPending: false,
  sendGrace: false,
  draft: "",
  files: [],
  temporary: false,
  error: undefined,
  errorMessageId: undefined,
  queuedFollowUps: [],
};

const replaceMessage = ({
  messages,
  message,
  replacementId,
}: {
  messages: ChatMessage[];
  message: ChatMessage;
  replacementId?: string;
}): ChatMessage[] => {
  const messageIndex = messages.findIndex((candidate) => candidate.id === message.id);
  const replacementIndex =
    messageIndex === -1 && replacementId !== undefined
      ? messages.findIndex((candidate) => candidate.id === replacementId)
      : messageIndex;
  if (replacementIndex === -1) return [...messages, message];
  return [...messages.slice(0, replacementIndex), message, ...messages.slice(replacementIndex + 1)];
};

const removeMessage = ({ messages, messageId }: { messages: ChatMessage[]; messageId?: string }) =>
  messageId === undefined ? messages : messages.filter((message) => message.id !== messageId);

export const chatSessionMachine = setup({
  types: {
    context: {} as ChatSession,
    events: {} as ChatSessionEvent,
  },
  actions: {
    changeDraft: assign(({ event }) =>
      event.type === "draft-changed" ? { draft: event.draft } : {},
    ),
    changeFiles: assign(({ event }) =>
      event.type === "files-changed" ? { files: event.files } : {},
    ),
    addFiles: assign(({ context, event }) =>
      event.type === "files-added" ? { files: [...context.files, ...event.files] } : {},
    ),
    changeTemporary: assign(({ event }) =>
      event.type === "temporary-changed" ? { temporary: event.temporary } : {},
    ),
    startFresh: assign(({ context }) => ({
      ...initialChatSession,
      temporary: context.temporary,
      draft: context.draft,
      files: context.files,
    })),
    openConversation: assign(({ context, event }) =>
      event.type === "conversation-opened"
        ? {
            ...initialChatSession,
            conversationId: event.conversationId,
            messages: event.messages,
            draft: context.draft,
            files: context.files,
          }
        : {},
    ),
    openThread: assign(({ context, event }) =>
      event.type === "thread-opened"
        ? {
            ...initialChatSession,
            conversationId: context.conversationId,
            threadId: event.threadId,
            messages: event.messages,
            draft: context.draft,
            files: context.files,
          }
        : {},
    ),
    identifyConversation: assign(({ event }) =>
      event.type === "conversation-identified" ? { conversationId: event.conversationId } : {},
    ),
    markSendPending: assign({ sendPending: () => true }),
    startStream: assign(({ context, event }) =>
      event.type === "stream-started"
        ? {
            messages: removeMessage({
              messages: event.messages,
              messageId: context.failedStreamMessageId,
            }),
            resumeMessageId: undefined,
            streamMessageId: undefined,
            failedStreamMessageId: undefined,
            streamOrigin: "send",
            streamOutcome: undefined,
            sendPending: false,
            sendGrace: true,
            draft: "",
            files: [],
            error: undefined,
            errorMessageId: undefined,
          }
        : {},
    ),
    resumeStream: assign(({ context }) => {
      const lastMessage = context.messages.at(-1);
      return {
        error: undefined,
        resumeMessageId: lastMessage?.role === "assistant" ? lastMessage.id : undefined,
        streamMessageId: undefined,
        failedStreamMessageId: undefined,
        streamOrigin: "resume",
        streamOutcome: undefined,
        sendPending: false,
        sendGrace: false,
      };
    }),
    updateStream: assign(({ context, event }) => {
      if (event.type !== "stream-message") return {};
      return {
        messages: replaceMessage({
          messages: context.messages,
          message: event.message,
          replacementId: context.resumeMessageId,
        }),
        resumeMessageId: undefined,
        streamMessageId: event.message.id,
        failedStreamMessageId: undefined,
      };
    }),
    completeStream: assign({
      streamOutcome: () => "completed" as const,
      sendPending: () => false,
    }),
    cancelStream: assign({
      streamOutcome: () => "cancelled" as const,
      sendPending: () => false,
    }),
    finishStream: assign({
      resumeMessageId: () => undefined,
      sendPending: () => false,
    }),
    endSendGrace: assign({ sendGrace: () => false }),
    reportError: assign(({ context, event }) =>
      event.type === "error-reported" &&
      context.streamOutcome !== "completed" &&
      context.streamOutcome !== "cancelled"
        ? {
            error: event.error,
            errorMessageId: event.messageId,
            streamOutcome: "failed" as const,
            sendPending: false,
            failedStreamMessageId:
              context.streamOutcome === undefined && context.streamOrigin === "send"
                ? context.streamMessageId
                : context.failedStreamMessageId,
          }
        : {},
    ),
    clearError: assign({ error: () => undefined, errorMessageId: () => undefined }),
    replaceQueuedFollowUps: assign(({ event }) =>
      event.type === "queued-follow-ups-replaced" ? { queuedFollowUps: event.items } : {},
    ),
    queueFollowUp: assign(({ context, event }) =>
      event.type === "follow-up-queued"
        ? {
            sendPending: false,
            draft: "",
            files: [],
            queuedFollowUps: [...context.queuedFollowUps, event.followUp],
          }
        : {},
    ),
    forceQueuedFollowUp: assign(({ context, event }) => {
      if (event.type !== "queued-follow-up-forced") return {};
      const followUp = context.queuedFollowUps.find((item) => item.id === event.id);
      if (followUp === undefined) return {};
      return {
        draft: followUp.text,
        files: followUp.files,
        queuedFollowUps: context.queuedFollowUps.filter((item) => item.id !== event.id),
      };
    }),
    updateQueuedFollowUp: assign(({ context, event }) => {
      if (event.type !== "queued-follow-up-updated") return {};
      return {
        queuedFollowUps: context.queuedFollowUps.map((item) =>
          item.id === event.id ? { ...item, text: event.text, files: event.files } : item,
        ),
      };
    }),
    removeQueuedFollowUp: assign(({ context, event }) =>
      event.type === "queued-follow-up-removed"
        ? { queuedFollowUps: context.queuedFollowUps.filter((item) => item.id !== event.id) }
        : {},
    ),
  },
}).createMachine({
  id: "chatSession",
  initial: "idle",
  context: () => initialChatSession,
  states: {
    idle: {
      on: {
        "draft-changed": { actions: "changeDraft" },
        "files-changed": { actions: "changeFiles" },
        "files-added": { actions: "addFiles" },
        "temporary-changed": { actions: "changeTemporary" },
        "fresh-started": { actions: "startFresh" },
        "conversation-opened": { actions: "openConversation" },
        "thread-opened": { actions: "openThread" },
        "conversation-identified": { actions: "identifyConversation" },
        "send-pending": { actions: "markSendPending" },
        "stream-started": { target: "streaming", actions: "startStream" },
        "stream-resumed": { target: "streaming", actions: "resumeStream" },
        "error-reported": { actions: "reportError" },
        "error-cleared": { actions: "clearError" },
        "queued-follow-up-forced": { actions: "forceQueuedFollowUp" },
        "queued-follow-up-updated": { actions: "updateQueuedFollowUp" },
        "queued-follow-up-removed": { actions: "removeQueuedFollowUp" },
        "queued-follow-ups-replaced": { actions: "replaceQueuedFollowUps" },
      },
    },
    streaming: {
      after: {
        600: { actions: "endSendGrace" },
      },
      on: {
        "draft-changed": { actions: "changeDraft" },
        "files-changed": { actions: "changeFiles" },
        "files-added": { actions: "addFiles" },
        "temporary-changed": { actions: "changeTemporary" },
        "fresh-started": { target: "idle", actions: "startFresh" },
        "conversation-opened": { target: "idle", actions: "openConversation" },
        "thread-opened": { target: "idle", actions: "openThread" },
        "conversation-identified": { actions: "identifyConversation" },
        "send-pending": { actions: "markSendPending" },
        "stream-message": { actions: "updateStream" },
        "stream-completed": { actions: "completeStream" },
        "stream-cancelled": { actions: "cancelStream" },
        "stream-finished": { target: "idle", actions: "finishStream" },
        "error-reported": { actions: "reportError" },
        "error-cleared": { actions: "clearError" },
        "follow-up-queued": { actions: "queueFollowUp" },
        "queued-follow-up-forced": { target: "idle", actions: "forceQueuedFollowUp" },
        "queued-follow-up-updated": { actions: "updateQueuedFollowUp" },
        "queued-follow-up-removed": { actions: "removeQueuedFollowUp" },
        "queued-follow-ups-replaced": { actions: "replaceQueuedFollowUps" },
      },
    },
  },
});
