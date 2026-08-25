// AI SDK UIMessage <-> vendored protocol mapping (Phase B wire-up).
// Ported from emi-healthfit @emi/core chat/ui-messages.ts, adapted to zod +
// extended with the dadabase approval flow: ai-sdk tool parts in state
// `approval-requested` map to a protocol extension part (`dadabase.chat` /
// `tool-approval`) because the protocol models neither approvals nor interrupts
// natively; on decision they are re-emitted as `approval-responded`.
import { readUIMessageStream, parseJsonEventStream, uiMessageChunkSchema } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

import type { ChatMessage } from "../protocol/messages.ts";
import { MessagePartSchema, type MessagePart } from "../protocol/parts.ts";

export const APPROVAL_EXTENSION_NAMESPACE = "dadabase.chat";
export const APPROVAL_EXTENSION_NAME = "tool-approval";

const ApprovalDataSchema = z.object({
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
type ApprovalData = z.infer<typeof ApprovalDataSchema>;

interface ApprovalExtensionPart {
  readonly type: "extension";
  readonly namespace: string;
  readonly name: string;
  readonly data: unknown;
}

const asApprovalExtensionPart = (part: MessagePart): ApprovalExtensionPart | undefined => {
  const candidate = part as unknown as Partial<ApprovalExtensionPart>;
  if (
    candidate.type === "extension" &&
    candidate.namespace === APPROVAL_EXTENSION_NAMESPACE &&
    candidate.name === APPROVAL_EXTENSION_NAME
  ) {
    return candidate as ApprovalExtensionPart;
  }
  return undefined;
};

/** Find the first pending tool-approval extension part in a message. */
export const findPendingApproval = (
  message: ChatMessage | undefined,
): (ApprovalData & { partIndex: number }) | undefined => {
  if (message === undefined) return undefined;
  for (const [index, part] of message.parts.entries()) {
    const extensionPart = asApprovalExtensionPart(part);
    if (extensionPart === undefined) continue;
    const decoded = ApprovalDataSchema.safeParse(extensionPart.data);
    if (decoded.success) return { ...decoded.data, partIndex: index };
  }
  return undefined;
};

/** True when any message in the thread still waits on an approval decision. */
export const hasPendingApproval = (messages: ReadonlyArray<ChatMessage>): boolean =>
  messages.some((message) => findPendingApproval(message) !== undefined);

// Re-exported for the thread adapter (vendored Phase A contract).
export type ChatUiMessageRole = UIMessage["role"] | "summary";
export type ChatUiMessage = Omit<UIMessage, "role"> & { role: ChatUiMessageRole };

export class ChatUiMessagesError extends Error {
  readonly code: string;
  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.name = "ChatUiMessagesError";
    this.code = code;
  }
}

type UiMessagePart = UIMessage["parts"][number];

const defaultCreateId = (): string => crypto.randomUUID();

// AI SDK emits step-start markers per streamed step; the protocol models one
// assistant message without step boundaries, so they are skipped.
const isStepStartUIPart = (part: UiMessagePart): boolean => part.type === "step-start";

const decodeProtocolPart = (value: unknown): MessagePart => {
  const parsed = MessagePartSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChatUiMessagesError({
      code: "invalid-protocol-message-part",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  return parsed.data;
};

const isToolUIPart = (
  part: UiMessagePart,
): part is UiMessagePart & {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
} => "toolCallId" in part && "state" in part;

const toolNameOf = (part: UiMessagePart): string => {
  if ("toolName" in part && typeof part.toolName === "string") return part.toolName;
  if ("type" in part && typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return "unknown";
};

const toProtocolPart = ({ part, createId }: { part: UiMessagePart; createId: () => string }): MessagePart => {
  if (part.type === "text") return decodeProtocolPart({ type: "text", text: part.text });
  if (part.type === "reasoning") {
    return decodeProtocolPart({ type: "reasoning", text: part.text });
  }
  if (part.type === "file") {
    return decodeProtocolPart({
      type: "file",
      file: {
        id: createId(),
        name: part.filename ?? "attachment",
        mediaType: part.mediaType,
        url: part.url,
      },
    });
  }
  if (!isToolUIPart(part)) {
    throw new ChatUiMessagesError({
      code: "unsupported-ui-message-part",
      message: `The AI SDK message part ${String(part.type)} has no provider-neutral protocol representation.`,
    });
  }

  const common = {
    type: "tool-invocation" as const,
    toolCallId: part.toolCallId,
  };
  const input = part.input ?? {};

  // dadabase extension: surface pending approvals as protocol extension parts.
  if (part.state === "approval-requested") {
    const decoded = ApprovalDataSchema.safeParse({
      approvalId: part.approval?.id ?? "",
      toolCallId: part.toolCallId,
      toolName: toolNameOf(part),
    });
    if (!decoded.success) {
      throw new ChatUiMessagesError({
        code: "invalid-approval-request",
        message: "The AI SDK approval request is missing its id.",
      });
    }
    return decodeProtocolPart({
      type: "extension",
      namespace: APPROVAL_EXTENSION_NAMESPACE,
      name: APPROVAL_EXTENSION_NAME,
      data: decoded.data,
    });
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return decodeProtocolPart({
      ...common,
      type: "tool-invocation",
      toolName: toolNameOf(part),
      state: "input-available",
      input,
    });
  }
  if (part.state === "output-available") {
    return decodeProtocolPart({
      type: "tool-invocation",
      toolName: toolNameOf(part),
      toolCallId: part.toolCallId,
      state: "output-available",
      input,
      output: part.output ?? null,
    });
  }
  if (part.state === "output-error") {
    return decodeProtocolPart({
      type: "tool-invocation",
      toolName: toolNameOf(part),
      toolCallId: part.toolCallId,
      state: "output-error",
      input,
      errorText: part.errorText,
    });
  }
  if (part.state === "output-denied") {
    return decodeProtocolPart({
      type: "tool-invocation",
      toolName: toolNameOf(part),
      toolCallId: part.toolCallId,
      state: "output-error",
      input,
      errorText: part.approval?.reason ?? "Tool invocation denied.",
    });
  }
  // `approval-responded` is transient (the run resumes server-side); the
  // protocol keeps showing the pending-approval extension until results land.
  if (part.state === "approval-responded") {
    const decoded = ApprovalDataSchema.safeParse({
      approvalId: part.approval?.id ?? "",
      toolCallId: part.toolCallId,
      toolName: toolNameOf(part),
    });
    if (decoded.success) {
      return decodeProtocolPart({
        type: "extension",
        namespace: APPROVAL_EXTENSION_NAMESPACE,
        name: APPROVAL_EXTENSION_NAME,
        data: decoded.data,
      });
    }
  }
  throw new ChatUiMessagesError({
    code: "unsupported-tool-state",
    message: `The AI SDK tool part ${toolNameOf(part)} is in an unmapped state: ${part.state}`,
  });
};

export const ChatUiMessages = {
  /** Map streamed/complete AI SDK UIMessage parts into protocol parts. */
  toProtocolParts({
    parts,
    createId = defaultCreateId,
  }: {
    parts: ReadonlyArray<UiMessagePart>;
    createId?: () => string;
  }): Array<MessagePart> {
    const out: Array<MessagePart> = [];
    for (const part of parts) {
      if (isStepStartUIPart(part)) continue;
      out.push(toProtocolPart({ part, createId }));
    }
    return out;
  },

  /**
   * Map a protocol message into a wire UIMessage for the transport encoder.
   * Tool invocations become dynamic tools; pending-approval extension parts are
   * reconstructed as `approval-requested` dynamic-tool parts so the server
   * knows a paused run exists.
   */
  toUiMessage(message: ChatMessage): UIMessage {
    const parts: UiMessagePart[] = [];
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        parts.push(part);
        continue;
      }
      if (part.type === "file") {
        parts.push({
          type: "file",
          filename: part.file.name,
          mediaType: part.file.mediaType,
          url: part.file.url,
        });
        continue;
      }
      if (part.type === "tool-call") {
        parts.push({
          type: "dynamic-tool",
          toolName: part.call.name,
          toolCallId: part.call.id,
          state: "input-available",
          input: part.call.input,
        });
        continue;
      }
      if (part.type === "tool-result") {
        parts.push(
          part.result.isError === true
            ? {
                type: "dynamic-tool",
                toolName: "unknown",
                toolCallId: part.result.callId,
                state: "output-error",
                input: {},
                errorText: JSON.stringify(part.result.output),
              }
            : {
                type: "dynamic-tool",
                toolName: "unknown",
                toolCallId: part.result.callId,
                state: "output-available",
                input: {},
                output: part.result.output,
              },
        );
        continue;
      }
      if (part.type === "tool-invocation") {
        if (part.state === "input-available") {
          parts.push({
            type: "dynamic-tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            state: "input-available",
            input: part.input,
          });
        } else if (part.state === "output-error") {
          parts.push({
            type: "dynamic-tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            state: "output-error",
            input: part.input,
            errorText: part.errorText ?? "Tool invocation failed.",
          });
        } else {
          parts.push({
            type: "dynamic-tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            state: "output-available",
            input: part.input,
            output: part.output ?? null,
          });
        }
        continue;
      }
      const approvalPart = asApprovalExtensionPart(part);
      if (approvalPart !== undefined) {
        const decoded = ApprovalDataSchema.safeParse(approvalPart.data);
        if (decoded.success) {
          parts.push({
            type: "dynamic-tool",
            toolName: decoded.data.toolName,
            toolCallId: decoded.data.toolCallId,
            state: "approval-requested",
            input: {},
            approval: { id: decoded.data.approvalId },
          });
        }
      }
    }
    return {
      id: message.id,
      role: message.role === "summary" || message.role === "tool" ? "assistant" : message.role,
      parts,
    };
  },

  /**
   * Build the wire messages array for a transport request. When an approval
   * decision is armed, the matching `approval-requested` dynamic-tool part on
   * the last assistant message becomes `approval-responded` so the server
   * resumes (or denies) the paused tool run.
   */
  toWireMessages({
    messages,
    approvalDecision,
  }: {
    messages: ReadonlyArray<ChatMessage>;
    approvalDecision?: { readonly approvalId: string; readonly approved: boolean } | undefined;
  }): Array<UIMessage> {
    const wire = messages.map((message) => ChatUiMessages.toUiMessage(message));
    if (approvalDecision !== undefined) {
      for (let index = wire.length - 1; index >= 0; index -= 1) {
        const candidate = wire[index];
        if (candidate.role !== "assistant") continue;
        let matched = false;
        for (const part of candidate.parts) {
          if (
            isToolUIPart(part) &&
            part.state === "approval-requested" &&
            part.approval?.id === approvalDecision.approvalId
          ) {
            const responded = part as unknown as {
              state: string;
              approval: { id: string; approved?: boolean; reason?: string };
            };
            responded.state = "approval-responded";
            responded.approval = {
              id: approvalDecision.approvalId,
              approved: approvalDecision.approved,
              ...(approvalDecision.approved ? {} : { reason: "Denied by user." }),
            };
            matched = true;
          }
        }
        if (matched) break;
      }
    }
    return wire;
  },

  /**
   * ChatStreamDecoder body: consume an SSE response of UIMessage chunks and
   * emit accumulated protocol ChatMessages via `sendMessage`.
   */
  async decodeStream({
    response,
    now,
    createId,
    inactivityTimeoutMilliseconds,
    sendMessage,
    isCurrent,
  }: {
    response: Response;
    now: () => string;
    createId: () => string;
    inactivityTimeoutMilliseconds: number;
    sendMessage: (message: ChatMessage) => void;
    isCurrent: () => boolean;
  }): Promise<ChatMessage | undefined> {
    if (response.body === null) {
      throw new ChatUiMessagesError({
        code: "missing-stream",
        message: "Chat response did not contain a stream.",
      });
    }
    let latest: ChatMessage | undefined;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), inactivityTimeoutMilliseconds);
    try {
      const uiStream = readUIMessageStream({
        stream: parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema }).pipeThrough(
          new TransformStream({
            transform(result, controller) {
              if (!result.success) {
                controller.error(result.error);
                return;
              }
              controller.enqueue(result.value);
            },
          }),
        ),
        terminateOnError: true,
      });
      const reader = uiStream.getReader();
      while (true) {
        if (!isCurrent()) break;
        const race = await Promise.race([
          reader.read(),
          new Promise<"timeout">((resolve) => {
            timeout.signal.addEventListener("abort", () => resolve("timeout"), { once: true });
          }),
        ]);
        if (race === "timeout") {
          throw new ChatUiMessagesError({
            code: "stream-stalled",
            message: "Chat response stalled before completion.",
          });
        }
        if (race.done) break;
        const uiMessage = race.value;
        const parts = ChatUiMessages.toProtocolParts({ parts: uiMessage.parts, createId });
        const message: ChatMessage = {
          id: uiMessage.id.trim() === "" ? createId() : uiMessage.id,
          role: uiMessage.role,
          parts,
          createdAt: now(),
        };
        latest = message;
        sendMessage(message);
      }
    } finally {
      clearTimeout(timer);
    }
    return latest;
  },
} as const;
