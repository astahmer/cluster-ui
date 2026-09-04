import * as Effect from "effect/Effect"
import * as Duration from "effect/Duration";
import * as Stream from "effect/Stream";
import { z } from "zod";
import { fromCallback } from "xstate";

import type { ChatMessage } from "../protocol/messages.ts";
import type { MessagePart } from "../protocol/parts.ts";
import { ChatModelConfigurationSchema } from "../chat/request.ts";
import { readableErrorMessage } from "../chat/error-message.ts";
import type { ChatSessionEvent } from "../chat-session-machine.ts";
import type {
  ChatStreamDecoder,
  ChatTransportActorEvent,
  ChatTransportActorInput,
  ChatTransportError,
  ChatTransportRequest,
} from "./transport-types.ts";

const WireChunk = z.union([
  z.object({ type: z.literal("start"), messageId: z.optional(z.string()) }),
  z.object({ type: z.literal("text-start"), id: z.string() }),
  z.object({ type: z.literal("text-delta"), id: z.string(), delta: z.string() }),
  z.object({ type: z.literal("text-end"), id: z.string() }),
  // ai-sdk UIMessage tool chunks (cluster-ui extension to the vendored wire protocol)
  z.object({
    type: z.literal("tool-input-available"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool-output-available"),
    toolCallId: z.string(),
    output: z.unknown(),
    errorText: z.string().optional(),
  }),
  z.object({ type: z.literal("finish") }),
]);

type WireChunk = z.infer<typeof WireChunk>;

class ChatTransportStreamError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "ChatTransportStreamError";
  }
}

class ChatTransportRequestError extends Error {
  readonly messageId: string | undefined;

  constructor({ message, messageId }: ChatTransportError) {
    super(message);
    this.name = "ChatTransportRequestError";
    this.messageId = messageId;
  }
}

const errorMessage = ({ cause, fallback }: { cause: unknown; fallback: string }): string =>
  readableErrorMessage(cause, fallback);

const readWireChunk = (data: string): WireChunk | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  const result = WireChunk.safeParse(parsed);
  return result.success ? result.data : undefined;
};

const appendText = ({
  message,
  text,
  now,
}: {
  message: ChatMessage | undefined;
  text: string;
  now: () => string;
}): ChatMessage => {
  const current = message ?? {
    id: `assistant:${now()}`,
    role: "assistant" as const,
    parts: [],
    createdAt: now(),
  };
  const previous = current.parts.at(-1);
  const parts: MessagePart[] =
    previous?.type === "text"
      ? [...current.parts.slice(0, -1), { type: "text", text: previous.text + text }]
      : [...current.parts, { type: "text", text }];
  return { ...current, parts };
};

const assistantText = (message: ChatMessage): string =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

const defaultStreamInactivityTimeoutMilliseconds = 5 * 60 * 1_000;

const consumeStreamEffect = Effect.fn("chat.transport.consumeStream")(function* ({
  activeOperation,
  response,
  now,
  createId,
  inactivityTimeoutMilliseconds,
  sendSession,
  isCurrent,
}: {
  activeOperation: number;
  response: Response;
  now: () => string;
  createId: () => string;
  inactivityTimeoutMilliseconds: number;
  sendSession: (event: ChatSessionEvent) => void;
  isCurrent: (activeOperation: number) => boolean;
}) {
  const body = response.body;
  if (body === null)
    return yield* Effect.fail(
      new ChatTransportStreamError({ message: "Chat response did not contain a stream." }),
    );

  let buffer = "";
  let message: ChatMessage | undefined;
  yield* Stream.fromReadableStream({
    evaluate: () => body.pipeThrough(new TextDecoderStream()),
    onError: (cause) =>
      new ChatTransportStreamError({
        message: readableErrorMessage(cause, "Chat response stream failed."),
      }),
    releaseLockOnEnd: true,
  }).pipe(
    Stream.timeoutOrElse({
      duration: Duration.millis(inactivityTimeoutMilliseconds),
      orElse: () => Stream.fail(new ChatTransportStreamError({ message: "Chat response stalled before completion." })),
    }),
    Stream.takeWhile(() => isCurrent(activeOperation)),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice("data:".length)
            .trim();
          if (data === undefined || data === "[DONE]") continue;
          const decoded = readWireChunk(data);
          if (decoded === undefined) continue;
          if (decoded.type === "start") {
            message = {
              id: decoded.messageId ?? createId(),
              role: "assistant",
              parts: [],
              createdAt: now(),
            };
            sendSession({ type: "stream-message", message });
          }
          if (decoded.type === "text-delta") {
            message = appendText({ message, text: decoded.delta, now });
            sendSession({ type: "stream-message", message });
          }
          if (decoded.type === "tool-input-available" || decoded.type === "tool-output-available") {
            const base = message ?? {
              id: createId(),
              role: "assistant" as const,
              parts: [],
              createdAt: now(),
            };
            const parts = [...base.parts];
            const idx = parts.findIndex(
              (p) => p.type === "tool-invocation" && p.toolCallId === decoded.toolCallId,
            );
            if (decoded.type === "tool-input-available") {
              const part = {
                type: "tool-invocation" as const,
                toolName: decoded.toolName,
                toolCallId: decoded.toolCallId,
                state: "input-available" as const,
                input: decoded.input as never,
              } satisfies MessagePart;
              if (idx === -1) parts.push(part);
              else parts[idx] = { ...parts[idx], ...part };
            } else {
              if (idx !== -1) {
                const prev = parts[idx];
                if (prev.type === "tool-invocation") {
                  parts[idx] = {
                    ...prev,
                    state: decoded.errorText ? ("output-error" as const) : ("output-available" as const),
                    output: decoded.output as never,
                    ...(decoded.errorText ? { errorText: decoded.errorText } : {}),
                  };
                }
              }
            }
            message = { ...base, parts };
            sendSession({ type: "stream-message", message });
          }
        }
      }),
    ),
  );
  return message;
});

const consumeResponseEffect = Effect.fn("chat.transport.consumeResponse")(function* ({
  decoder,
  response,
  activeOperation,
  now,
  createId,
  inactivityTimeoutMilliseconds,
  sendSession,
  isCurrent,
}: {
  decoder: ChatStreamDecoder | undefined;
  response: Response;
  activeOperation: number;
  now: () => string;
  createId: () => string;
  inactivityTimeoutMilliseconds: number;
  sendSession: (event: ChatSessionEvent) => void;
  isCurrent: (activeOperation: number) => boolean;
}) {
  if (decoder !== undefined) {
    return yield* decoder({
      response,
      now,
      createId,
      inactivityTimeoutMilliseconds,
      sendMessage: (message) => sendSession({ type: "stream-message", message }),
      isCurrent: () => isCurrent(activeOperation),
    });
  }
  return yield* consumeStreamEffect({
    activeOperation,
    response,
    now,
    createId,
    inactivityTimeoutMilliseconds,
    sendSession,
    isCurrent,
  });
});

export const chatTransportActor = fromCallback<ChatTransportActorEvent, ChatTransportActorInput>(
  ({ input, receive }) => {
    let abortController: AbortController | undefined;
    let operation = 0;
    let activeSend: { readonly operation: number; started: boolean } | undefined;

    const supersede = () => {
      operation += 1;
      abortController?.abort();
      abortController = undefined;
      return operation;
    };

    const sendSuggestions = (
      suggestion: Parameters<NonNullable<ChatTransportActorInput["sendSuggestions"]>>[0],
    ) => {
      try {
        input.sendSuggestions?.(suggestion);
      } catch {
        return;
      }
    };

    const sendRequest = async ({
      activeOperation,
      controller,
      request,
    }: {
      activeOperation: number;
      controller: AbortController;
      request: ChatTransportRequest;
    }) => {
      const isActive = () => !controller.signal.aborted && activeOperation === operation;
      const createdConversationId =
        request.conversationId === undefined &&
        !request.temporary &&
        input.createConversation !== undefined
          ? await input.createConversation()
          : undefined;
      if (!isActive()) return;
      const resolvedRequest =
        createdConversationId === undefined
          ? request
          : { ...request, conversationId: createdConversationId };
      if (createdConversationId !== undefined)
        input.sendSession({
          type: "conversation-identified",
          conversationId: createdConversationId,
        });
      const message: ChatMessage = {
        id: resolvedRequest.messageId ?? input.createId(),
        role: "user",
        parts: [
          ...(resolvedRequest.text === ""
            ? []
            : [{ type: "text" as const, text: resolvedRequest.text }]),
          ...resolvedRequest.files.map((file) => ({ type: "file" as const, file })),
        ],
        createdAt: input.now(),
      };
      const messages = [...resolvedRequest.messages, message];
      if (activeSend?.operation === activeOperation) activeSend.started = true;
      input.sendSession({ type: "stream-started", messages });
      const encodedMessages =
        input.messageEncoder?.({ messages, request: resolvedRequest }) ?? messages;
      const response = await input.fetch(input.api, {
        body: JSON.stringify({
          ...resolvedRequest.body,
          messages: encodedMessages,
          sessionId: resolvedRequest.conversationId,
          threadId: resolvedRequest.threadId,
          temporary: resolvedRequest.temporary,
          ...(resolvedRequest.replaceMessageId === undefined
            ? {}
            : { replaceMessageId: resolvedRequest.replaceMessageId }),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      if (!isActive()) return;
      const conversationId =
        response.headers.get("x-conversation-id") ?? response.headers.get("x-thread-id");
      if (
        !resolvedRequest.temporary &&
        conversationId !== null &&
        conversationId !== resolvedRequest.conversationId
      ) {
        input.sendSession({ type: "conversation-identified", conversationId });
      }
      if (!response.ok) {
        const decoded = await input.errorDecoder?.({ response });
        throw new ChatTransportRequestError(
          decoded === undefined
            ? { message: `Chat request failed (${response.status}).`, messageId: message.id }
            : { message: decoded.message, messageId: decoded.messageId ?? message.id },
        );
      }
      const compacted = response.headers.get("x-conversation-compacted") !== null;
      try {
        return await Effect.runPromise(
          consumeResponseEffect({
            decoder: input.streamDecoder,
            activeOperation,
            response,
            now: input.now,
            createId: input.createId,
            inactivityTimeoutMilliseconds:
              input.streamInactivityTimeoutMilliseconds ??
              defaultStreamInactivityTimeoutMilliseconds,
            sendSession: (event) => {
              if (isActive()) input.sendSession(event);
            },
            isCurrent: () => isActive(),
          }),
        );
      } catch (cause) {
        throw new ChatTransportRequestError({
          message: errorMessage({ cause, fallback: "Unable to complete this chat request." }),
          messageId: message.id,
        });
      } finally {
        if (compacted && resolvedRequest.conversationId !== undefined && isActive()) {
          input.sendSession({
            type: "conversation-compacted",
            conversationId: resolvedRequest.conversationId,
          });
        }
      }
    };

    const run = async ({
      request,
      activeOperation,
      controller,
    }: {
      request: ChatTransportRequest;
      activeOperation: number;
      controller: AbortController;
    }) => {
      try {
        const message = await sendRequest({ activeOperation, controller, request });
        if (controller.signal.aborted || activeOperation !== operation) return;
        if (message !== undefined) {
          const text = assistantText(message);
          if (text !== "") {
            const config = ChatModelConfigurationSchema.safeParse(request.body.config);
            if (config.success)
              sendSuggestions({
                lastAssistantText: text,
                lastUserText: request.text,
                threadId: request.threadId,
                messageId: message.id,
                config: config.data,
              });
          }
        }
        input.sendSession({ type: "stream-completed" });
      } catch (cause) {
        if (controller.signal.aborted || activeOperation !== operation) return;
        input.sendSession({
          type: "error-reported",
          error: errorMessage({ cause, fallback: "Unable to complete this chat request." }),
          messageId:
            cause instanceof ChatTransportRequestError ? cause.messageId : request.messageId,
        });
      } finally {
        if (abortController === controller) abortController = undefined;
        if (activeSend?.operation === activeOperation) activeSend = undefined;
        if (activeOperation === operation) input.sendSession({ type: "stream-finished" });
      }
    };

    const beginSend = (request: ChatTransportRequest) => {
      const controller = new AbortController();
      const activeOperation = operation + 1;
      operation = activeOperation;
      abortController = controller;
      activeSend = { operation: activeOperation, started: false };
      input.sendSession({ type: "send-pending" });
      void run({ request, activeOperation, controller });
    };

    const send = (request: ChatTransportRequest) => {
      if (activeSend !== undefined) {
        if (request.replaceMessageId === undefined) return;
        supersede();
      }
      beginSend(request);
    };

    const resume = (conversationId: string) => {
      const controller = new AbortController();
      const activeOperation = supersede();
      const isActive = () => !controller.signal.aborted && activeOperation === operation;
      abortController = controller;
      input.sendSession({ type: "stream-resumed" });
      void (async () => {
        try {
          const response = await input.fetch(
            `${input.api}/${encodeURIComponent(conversationId)}/stream`,
            {
              signal: controller.signal,
            },
          );
          if (!isActive()) return;
          if (!response.ok) {
            const decoded = await input.errorDecoder?.({ response });
            throw new ChatTransportRequestError(
              decoded ?? { message: `Chat resume failed (${response.status}).` },
            );
          }
          if (response.status === 204) return;
          await Effect.runPromise(
            consumeResponseEffect({
              decoder: input.streamDecoder,
              activeOperation,
              response,
              now: input.now,
              createId: input.createId,
              inactivityTimeoutMilliseconds:
                input.streamInactivityTimeoutMilliseconds ??
                defaultStreamInactivityTimeoutMilliseconds,
              sendSession: (event) => {
                if (isActive()) input.sendSession(event);
              },
              isCurrent: () => isActive(),
            }),
          );
          if (controller.signal.aborted || activeOperation !== operation) return;
          input.sendSession({ type: "stream-completed" });
        } catch (cause) {
          if (controller.signal.aborted || activeOperation !== operation) return;
          input.sendSession({
            type: "error-reported",
            error: errorMessage({ cause, fallback: "Unable to resume this conversation." }),
            ...(cause instanceof ChatTransportRequestError && cause.messageId === undefined
              ? {}
              : cause instanceof ChatTransportRequestError
                ? { messageId: cause.messageId }
                : {}),
          });
        } finally {
          if (abortController === controller) abortController = undefined;
          if (activeOperation === operation) input.sendSession({ type: "stream-finished" });
        }
      })();
    };

    receive((event) => {
      if (event.type === "stream-send-requested") send(event.request);
      if (event.type === "stream-resume-requested" || event.type === "stream-retry-requested")
        resume(event.conversationId);
      if (event.type === "stream-cancelled") {
        supersede();
        input.sendSession({ type: "stream-cancelled" });
        input.sendSession({ type: "stream-finished" });
      }
      if (event.type === "queued-follow-up-force-requested") {
        supersede();
        input.sendSession({ type: "queued-follow-up-forced", id: event.followUp.id });
        beginSend({ ...event.request, ...event.followUp });
      }
    });

    return () => {
      supersede();
    };
  },
);
