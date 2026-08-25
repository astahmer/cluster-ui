import * as Effect from "effect/Effect";

import type { ChatModelConfiguration } from "../chat/request.ts";
import type { ChatMessage } from "../protocol/messages.ts";
import type { Attachment } from "../protocol/parts.ts";
import type { ChatSessionEvent, QueuedFollowUp } from "../chat-session-machine.ts";

export interface ChatTransportRequest {
  conversationId: string | undefined;
  threadId: string | undefined;
  temporary: boolean;
  messages: ChatMessage[];
  text: string;
  files: Attachment[];
  messageId?: string;
  replaceMessageId?: string;
  body: Record<string, unknown>;
}

export interface ChatTransportActorInput {
  api: string;
  fetch: typeof globalThis.fetch;
  createId: () => string;
  now: () => string;
  streamInactivityTimeoutMilliseconds?: number;
  createConversation?: () => Promise<string>;
  streamDecoder?: ChatStreamDecoder;
  errorDecoder?: ChatTransportErrorDecoder;
  messageEncoder?: ChatMessageEncoder;
  sendSession: (event: ChatSessionEvent) => void;
  sendSuggestions?: (input: {
    readonly lastAssistantText: string;
    readonly lastUserText: string;
    readonly threadId: string | undefined;
    readonly messageId: string | undefined;
    readonly config: ChatModelConfiguration;
  }) => void;
}

export interface ChatStreamDecoderInput {
  response: Response;
  now: () => string;
  createId: () => string;
  inactivityTimeoutMilliseconds: number;
  sendMessage: (message: ChatMessage) => void;
  isCurrent: () => boolean;
}

export type ChatStreamDecoder = (
  input: ChatStreamDecoderInput,
) => Effect.Effect<ChatMessage | undefined, unknown>;

export interface ChatTransportError {
  message: string;
  messageId?: string;
}

export type ChatTransportErrorDecoder = (input: {
  response: Response;
}) => Promise<ChatTransportError | undefined>;

/** An armed approve/reject decision for a paused `needsApproval` tool call. */
export interface ChatApprovalDecision {
  approvalId: string;
  approved: boolean;
}

export type ChatMessageEncoder = (input: {
  messages: ReadonlyArray<ChatMessage>;
  request: ChatTransportRequest;
  /** Set when the send was triggered by `approveToolCall`; consumed once. */
  approvalDecision?: ChatApprovalDecision | undefined;
}) => ReadonlyArray<unknown>;

export type ChatTransportActorEvent =
  | { type: "stream-send-requested"; request: ChatTransportRequest }
  | { type: "stream-resume-requested"; conversationId: string }
  | { type: "stream-retry-requested"; conversationId: string }
  | { type: "stream-cancelled" }
  | {
      type: "queued-follow-up-force-requested";
      followUp: QueuedFollowUp;
      request: Omit<ChatTransportRequest, "files" | "text">;
    };
