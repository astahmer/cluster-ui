import { assign, fromCallback, sendTo, setup } from "xstate";

import {
  defaultGenericChatSettings,
  PersistedGenericChatSettingsSchema,
  type GenericChatSettings,
} from "../chat/settings.ts";

export interface SettingsStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => unknown;
}

export interface SettingsActorInput {
  storage: SettingsStorage;
  storageKey: string;
  defaults?: GenericChatSettings;
}

export interface SettingsActorContext {
  settings: GenericChatSettings;
  hydrated: boolean;
  error: string | undefined;
  storage: SettingsStorage;
  storageKey: string;
  defaults: GenericChatSettings;
}

export type SettingsActorEvent =
  | { type: "settings-patch-requested"; patch: Partial<GenericChatSettings> }
  | { type: "settings-hydrated"; settings: GenericChatSettings }
  | { type: "settings-persistence-failed"; error: string };

const errorMessage = ({ cause }: { cause: unknown }): string =>
  cause instanceof Error ? cause.message : "Unable to save chat settings.";

const normalizeSettings = ({
  defaults,
  settings,
}: {
  defaults: GenericChatSettings;
  settings: Partial<GenericChatSettings>;
}): GenericChatSettings => ({
  ...defaults,
  ...settings,
  model: settings.model || defaults.model,
  titleModel: settings.titleModel || defaults.titleModel,
  webSearch: settings.webSearch ?? defaults.webSearch,
});

const settingsOperations = fromCallback<SettingsActorEvent, SettingsActorInput>(
  ({ input, receive, sendBack }) => {
    const defaults = input.defaults ?? defaultGenericChatSettings;
    const hydrate = (stored: string | null) => {
      try {
        const parsed =
          stored === null
            ? undefined
            : PersistedGenericChatSettingsSchema.safeParse(JSON.parse(stored));
        sendBack({
          type: "settings-hydrated",
          settings:
            parsed?.success === true
              ? normalizeSettings({ defaults, settings: parsed.data })
              : defaults,
        });
      } catch {
        sendBack({ type: "settings-hydrated", settings: defaults });
      }
    };
    try {
      const stored = input.storage.getItem(input.storageKey);
      if (stored instanceof Promise) void stored.then(hydrate, () => hydrate(null));
      else hydrate(stored);
    } catch {
      hydrate(null);
    }

    receive((event) => {
      if (event.type !== "settings-patch-requested") return;
      try {
        const result = input.storage.setItem(input.storageKey, JSON.stringify(event.patch));
        if (result instanceof Promise)
          void result.catch((cause: unknown) =>
            sendBack({ type: "settings-persistence-failed", error: errorMessage({ cause }) }),
          );
      } catch (cause) {
        sendBack({ type: "settings-persistence-failed", error: errorMessage({ cause }) });
      }
    });
  },
);

export const settingsActor = setup({
  types: {
    context: {} as SettingsActorContext,
    input: {} as SettingsActorInput,
    events: {} as SettingsActorEvent,
  },
  actors: { operations: settingsOperations },
  actions: {
    patchSettings: assign(({ context, event }) =>
      event.type === "settings-patch-requested"
        ? {
            settings: normalizeSettings({
              defaults: context.defaults,
              settings: { ...context.settings, ...event.patch },
            }),
            error: undefined,
          }
        : {},
    ),
    hydrateSettings: assign(({ event }) =>
      event.type === "settings-hydrated" ? { settings: event.settings, hydrated: true } : {},
    ),
    reportPersistenceFailure: assign(({ event }) =>
      event.type === "settings-persistence-failed" ? { error: event.error } : {},
    ),
    persistSettings: sendTo("operations", ({ context, event }) =>
      event.type === "settings-patch-requested"
        ? { type: "settings-patch-requested", patch: context.settings }
        : { type: "settings-patch-requested", patch: {} },
    ),
  },
}).createMachine({
  id: "settings",
  context: ({ input }) => {
    const defaults = input.defaults ?? defaultGenericChatSettings;
    return {
      settings: defaults,
      hydrated: false,
      error: undefined,
      storage: input.storage,
      storageKey: input.storageKey,
      defaults,
    };
  },
  invoke: {
    id: "operations",
    src: "operations",
    input: ({ context }) => ({
      storage: context.storage,
      storageKey: context.storageKey,
      defaults: context.defaults,
    }),
  },
  on: {
    "settings-patch-requested": { actions: ["patchSettings", "persistSettings"] },
    "settings-hydrated": { actions: "hydrateSettings" },
    "settings-persistence-failed": { actions: "reportPersistenceFailure" },
  },
});
