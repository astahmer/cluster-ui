// Vendored from emi-healthfit @emi/core (chat/settings.ts), adapted to zod.
import { z } from "zod";

const ThemeSchema = z.enum(["light", "dark"]);
export type Theme = z.infer<typeof ThemeSchema>;

export const GenericChatSettingsSchema = z.object({
  provider: z.string().min(1).regex(/\S/),
  apiKey: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  systemPrompt: z.string(),
  titleModel: z.string(),
  titlePrompt: z.string(),
  memoryEnabled: z.boolean(),
  memoryModel: z.string(),
  webSearch: z.boolean(),
  showTokenUsage: z.boolean(),
  theme: ThemeSchema,
});

export const PersistedGenericChatSettingsSchema = z.object({
  provider: z.string().min(1).regex(/\S/),
  apiKey: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  systemPrompt: z.string(),
  titleModel: z.string(),
  titlePrompt: z.string(),
  memoryEnabled: z.boolean(),
  memoryModel: z.string(),
  webSearch: z.optional(z.boolean()),
  showTokenUsage: z.optional(z.boolean()),
  theme: z.optional(ThemeSchema),
});

export type GenericChatSettings = z.infer<typeof GenericChatSettingsSchema>;

export const defaultGenericChatSettings: GenericChatSettings = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "gpt-4o-mini",
  systemPrompt: "",
  titleModel: "gpt-4o-mini",
  titlePrompt: "",
  memoryEnabled: true,
  memoryModel: "gpt-4o-mini",
  webSearch: false,
  showTokenUsage: false,
  theme: "light",
};
