// Vendored from emi-healthfit @emi/core (protocol/model.ts), adapted to zod.
import type * as Stream from "effect/Stream";
import { z } from "zod";
import { GenerationIdSchema } from "./ids.ts";
import { ChatMessageSchema } from "./messages.ts";
import { MessagePartSchema } from "./parts.ts";
import { TransportErrorSchema, type TransportError } from "./errors.ts";

const nonEmptyIdentifier = z.string().min(1).regex(/\S/);
const nonNegativeInteger = z.number().int().min(0);
const nonNegativeNumber = z.number().min(0);

export const ModelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  imageInput: z.boolean(),
  fileInput: z.boolean(),
  structuredOutput: z.boolean(),
  webSearch: z.boolean(),
  voiceInput: z.boolean(),
  voiceOutput: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelDescriptorSchema = z.object({
  id: nonEmptyIdentifier,
  label: nonEmptyIdentifier,
  description: z.string(),
  provider: nonEmptyIdentifier,
  capabilities: ModelCapabilitiesSchema,
  limits: z.optional(
    z.object({
      contextTokens: z.optional(nonNegativeInteger),
      maxOutputTokens: z.optional(nonNegativeInteger),
    }),
  ),
  pricing: z.optional(
    z.object({
      inputUsdPerMillion: nonNegativeNumber,
      outputUsdPerMillion: nonNegativeNumber,
    }),
  ),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ModelConfigurationSchema = z.object({
  model: z.string().min(1).regex(/\S/),
  provider: z.optional(z.string().min(1).regex(/\S/)),
  temperature: z.optional(z.number().min(0).max(2)),
});
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;

export const ModelGenerationInputSchema = z.object({
  messages: z.array(ChatMessageSchema),
  configuration: ModelConfigurationSchema,
});
export type ModelGenerationInput = z.infer<typeof ModelGenerationInputSchema>;

export const GenerationEventSchema = z.union([
  z.object({ type: z.literal("started"), generationId: GenerationIdSchema }),
  z.object({ type: z.literal("message-part"), part: MessagePartSchema }),
  z.object({ type: z.literal("completed"), message: ChatMessageSchema }),
  z.object({ type: z.literal("failed"), error: TransportErrorSchema }),
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;

export type ModelProviderError = TransportError;

export interface ModelProvider {
  readonly generate: (
    input: ModelGenerationInput,
  ) => Stream.Stream<GenerationEvent, ModelProviderError>;
}
