// Vendored from emi-healthfit @emi/core (protocol/mappers.ts), adapted to zod.
import { Effect } from "effect";
import { z } from "zod";

import {
  ErrorResponseDtoSchema,
  ProtocolDecodeError,
  TransportErrorSchema,
  type ErrorResponseDto,
} from "./errors.ts";
import {
  ChatMessageDtoSchema,
  ChatMessageSchema,
  MessageRoleSchema,
  MessageUsageSchema,
  type ChatMessage,
  type ChatMessageDto,
} from "./messages.ts";
import {
  AttachmentSchema,
  DynamicComponentElementSchema,
  DynamicComponentEnvelopeSchema,
  DynamicComponentSpecSchema,
  ExtensionPartSchema,
  MessagePartSchema,
  ToolCallSchema,
  ToolResultSchema,
} from "./parts.ts";
import {
  AttachmentIdSchema,
  ConversationIdSchema,
  GenerationIdSchema,
  MemoryIdSchema,
  MessageIdSchema,
  ThreadIdSchema,
  TimestampSchema,
  ToolCallIdSchema,
} from "./ids.ts";
import {
  ConversationDtoSchema,
  ConversationSchema,
  MemoryDtoSchema,
  MemorySchema,
  MemorySummaryDtoSchema,
  MemorySummarySchema,
  ThreadDtoSchema,
  ThreadSchema,
  type Conversation,
  type ConversationDto,
  type Memory,
  type MemoryDto,
  type MemorySummary,
  type MemorySummaryDto,
  type Thread,
  type ThreadDto,
} from "./resources.ts";
import {
  GenerationEventSchema,
  ModelCapabilitiesSchema,
  ModelConfigurationSchema,
  ModelDescriptorSchema,
  ModelGenerationInputSchema,
  type ModelProviderError,
} from "./model.ts";

const protocolSchemas = {
  attachment: AttachmentSchema,
  dynamicComponentElement: DynamicComponentElementSchema,
  dynamicComponentEnvelope: DynamicComponentEnvelopeSchema,
  dynamicComponentSpec: DynamicComponentSpecSchema,
  attachmentId: AttachmentIdSchema,
  conversationId: ConversationIdSchema,
  generationId: GenerationIdSchema,
  memoryId: MemoryIdSchema,
  messageId: MessageIdSchema,
  threadId: ThreadIdSchema,
  timestamp: TimestampSchema,
  toolCallId: ToolCallIdSchema,
  toolCall: ToolCallSchema,
  toolResult: ToolResultSchema,
  extensionPart: ExtensionPartSchema,
  messagePart: MessagePartSchema,
  chatMessage: ChatMessageSchema,
  chatMessageDto: ChatMessageDtoSchema,
  conversation: ConversationSchema,
  conversationDto: ConversationDtoSchema,
  thread: ThreadSchema,
  threadDto: ThreadDtoSchema,
  memory: MemorySchema,
  memoryDto: MemoryDtoSchema,
  memorySummary: MemorySummarySchema,
  memorySummaryDto: MemorySummaryDtoSchema,
  messageRole: MessageRoleSchema,
  messageUsage: MessageUsageSchema,
  generationEvent: GenerationEventSchema,
  errorResponseDto: ErrorResponseDtoSchema,
  modelCapabilities: ModelCapabilitiesSchema,
  modelConfiguration: ModelConfigurationSchema,
  modelDescriptor: ModelDescriptorSchema,
  modelGenerationInput: ModelGenerationInputSchema,
  transportError: TransportErrorSchema,
  modelProviderError: TransportErrorSchema,
} as const;

export type ProtocolSchemas = typeof protocolSchemas;
export type ProtocolEffect<Value> = Effect.Effect<Value, ProtocolDecodeError>;

type ZodLikeSchema<Value> = { safeParse: (input: unknown) => { success: boolean; data?: Value; error?: { message: string } } };

export class ChatProtocol {
  static readonly schemas = protocolSchemas;

  static fromChatMessageDto(input: unknown): ProtocolEffect<ChatMessage> {
    return ChatProtocol.decode(ChatProtocol.schemas.chatMessageDto, input).pipe(
      Effect.map((value) => ChatProtocol.copyChatMessage(value)),
    );
  }

  static toChatMessageDto(input: ChatMessage): ProtocolEffect<ChatMessageDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.chatMessage, input).pipe(
      Effect.map((value) => ChatProtocol.copyChatMessage(value)),
    );
  }

  static fromConversationDto(input: unknown): ProtocolEffect<Conversation> {
    return ChatProtocol.decode(ChatProtocol.schemas.conversationDto, input);
  }

  static toConversationDto(input: Conversation): ProtocolEffect<ConversationDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.conversation, input);
  }

  static fromThreadDto(input: unknown): ProtocolEffect<Thread> {
    return ChatProtocol.decode(ChatProtocol.schemas.threadDto, input);
  }

  static toThreadDto(input: Thread): ProtocolEffect<ThreadDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.thread, input);
  }

  static fromMemoryDto(input: unknown): ProtocolEffect<Memory> {
    return ChatProtocol.decode(ChatProtocol.schemas.memoryDto, input);
  }

  static toMemoryDto(input: Memory): ProtocolEffect<MemoryDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.memory, input);
  }

  static fromMemorySummaryDto(input: unknown): ProtocolEffect<MemorySummary> {
    return ChatProtocol.decode(ChatProtocol.schemas.memorySummaryDto, input);
  }

  static toMemorySummaryDto(input: MemorySummary): ProtocolEffect<MemorySummaryDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.memorySummary, input);
  }

  static decodeErrorResponseDto(input: unknown): ProtocolEffect<ErrorResponseDto> {
    return ChatProtocol.decode(ChatProtocol.schemas.errorResponseDto, input);
  }

  static decodeModelProviderError(input: unknown): ProtocolEffect<ModelProviderError> {
    return ChatProtocol.decode(ChatProtocol.schemas.modelProviderError, input);
  }

  static runPromise<Value, Error>(effect: Effect.Effect<Value, Error>): Promise<Value> {
    return Effect.runPromise(effect);
  }

  private static decode<SchemaType extends ZodLikeSchema<unknown>>(
    schema: SchemaType,
    input: unknown,
  ): ProtocolEffect<SchemaType extends ZodLikeSchema<infer Value> ? Value : never> {
    return Effect.try({
      try: () => {
        const result = schema.safeParse(input);
        if (!result.success) throw new ProtocolDecodeError(result.error?.message ?? "decode failed");
        return result.data;
      },
      catch: (error) => error as ProtocolDecodeError,
    }) as never;
  }

  private static copyChatMessage(value: ChatMessage): ChatMessage {
    const base = {
      id: value.id,
      role: value.role,
      parts: [...value.parts],
      createdAt: value.createdAt,
    };
    const usage = value.usage;
    if (value.model === undefined && usage === undefined) return base;
    if (value.model !== undefined && usage !== undefined) {
      return {
        ...base,
        model: value.model,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
      };
    }
    if (value.model !== undefined) return { ...base, model: value.model };
    if (usage === undefined) return base;
    return {
      ...base,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    };
  }
}

// Re-exported for callers that validate without the Effect wrapper.
const decodeWithZod = (
  schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: unknown } },
  input: unknown,
): ProtocolEffect<unknown> =>
  Effect.try({
    try: () => {
      const result = schema.safeParse(input);
      if (!result.success)
        throw new ProtocolDecodeError(
          result.error instanceof Error ? result.error.message : "decode failed",
        );
      return result.data;
    },
    catch: (error) => error as ProtocolDecodeError,
  });

export const parseProtocol = <Value>(schema: z.ZodType<Value>, input: unknown): ProtocolEffect<Value> =>
  decodeWithZod(schema, input) as ProtocolEffect<Value>;
