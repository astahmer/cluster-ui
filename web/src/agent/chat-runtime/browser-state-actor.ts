import { assign, fromCallback, sendTo, setup } from "xstate";

import type { ChatSessionEvent } from "../chat-session-machine.ts";
import type { ChatRouteInput } from "../runtime/types.ts";
import type { SettingsStorage } from "./settings-actor.ts";

export interface BrowserStorageChange {
  readonly key: string | null;
  readonly newValue: string | null;
}

export interface BrowserStateAdapter {
  online: () => boolean;
  subscribeOnline: (listener: (online: boolean) => void) => () => void;
  subscribeStorage?: (
    listener: (event: BrowserStorageChange) => void,
  ) => () => void;
  storage: Pick<SettingsStorage, "getItem" | "setItem"> & {
    removeItem: (key: string) => unknown;
  };
}

export interface BrowserStateActorInput {
  browser: BrowserStateAdapter;
  draftStorageKey: string;
  sendSession: (event: ChatSessionEvent) => void;
}

export interface BrowserStateContext extends BrowserStateActorInput {
  online: boolean;
  draftHydrated: boolean;
  error: string | undefined;
}

export type BrowserStateActorEvent =
  | { type: "browser-noop" }
  | { type: "route-sync-requested"; route: ChatRouteInput }
  | { type: "online-changed"; online: boolean }
  | { type: "draft-persist-requested"; draft: string }
  | { type: "draft-restored"; draft: string }
  | { type: "draft-hydrated" }
  | { type: "browser-state-failed"; error: string };

const errorMessage = ({ cause }: { cause: unknown }): string =>
  cause instanceof Error ? cause.message : "Unable to update browser state.";

const browserStateOperations = fromCallback<BrowserStateActorEvent, BrowserStateActorInput>(
  ({ input, receive, sendBack }) => {
    let hydratedOnce = false;
    let persistCounter = 0;
    let lastPersistedDraft: string | undefined;
    const hydrate = (draft: string | null, requestedAt: number) => {
      hydratedOnce = true;
      if (requestedAt === persistCounter && draft !== null && draft !== "")
        sendBack({ type: "draft-restored", draft });
      sendBack({ type: "draft-hydrated" });
    };

    const unsubscribe = input.browser.subscribeOnline((online) => {
      sendBack({ type: "online-changed", online });
    });

    const unsubscribeStorage = input.browser.subscribeStorage?.((event) => {
      if (event.key !== input.draftStorageKey) return;
      const remoteDraft = event.newValue ?? "";
      if (remoteDraft === lastPersistedDraft) return;
      sendBack({ type: "draft-restored", draft: remoteDraft });
    });

    receive((event) => {
      if (event.type === "draft-persist-requested") {
        if (event.draft === lastPersistedDraft) return;
        lastPersistedDraft = event.draft;
        persistCounter += 1;
        try {
          const persistence =
            event.draft === ""
              ? input.browser.storage.removeItem(input.draftStorageKey)
              : input.browser.storage.setItem(input.draftStorageKey, event.draft);
          if (persistence instanceof Promise)
            void persistence.catch((cause: unknown) =>
              sendBack({ type: "browser-state-failed", error: errorMessage({ cause }) }),
            );
        } catch (cause) {
          sendBack({ type: "browser-state-failed", error: errorMessage({ cause }) });
        }
        return;
      }
      if (event.type === "route-sync-requested") {
        if (hydratedOnce || !event.route.historyReady) return;
        try {
          const requestedAt = persistCounter;
          const draft = input.browser.storage.getItem(input.draftStorageKey);
          if (draft instanceof Promise) {
            void draft.then(
              (value) => hydrate(value, requestedAt),
              (cause: unknown) => {
                sendBack({ type: "browser-state-failed", error: errorMessage({ cause }) });
                sendBack({ type: "draft-hydrated" });
              },
            );
          } else {
            hydrate(draft, requestedAt);
          }
        } catch (cause) {
          sendBack({ type: "browser-state-failed", error: errorMessage({ cause }) });
          sendBack({ type: "draft-hydrated" });
        }
        return;
      }
    });

    return () => {
      unsubscribeStorage?.();
      unsubscribe();
    };
  },
);

export const browserStateActor = setup({
  types: {
    context: {} as BrowserStateContext,
    input: {} as BrowserStateActorInput,
    events: {} as BrowserStateActorEvent,
  },
  actors: { operations: browserStateOperations },
  actions: {
    changeOnline: assign(({ event }) =>
      event.type === "online-changed" ? { online: event.online } : {},
    ),
    markDraftHydrated: assign(({ event }) =>
      event.type === "draft-hydrated" ? { draftHydrated: true } : {},
    ),
    restoreDraft: ({ context, event }) => {
      if (event.type === "draft-restored")
        context.sendSession({ type: "draft-changed", draft: event.draft });
    },
    forwardRouteSync: sendTo("operations", ({ event }) => event),
    reportFailure: assign(({ event }) =>
      event.type === "browser-state-failed" ? { error: event.error } : {},
    ),
    forwardDraftPersistence: sendTo("operations", ({ event }) => event),
  },
}).createMachine({
  id: "browserState",
  context: ({ input }) => ({
    ...input,
    online: input.browser.online(),
    draftHydrated: false,
    error: undefined,
  }),
  invoke: { id: "operations", src: "operations", input: ({ context }) => context },
  on: {
    "route-sync-requested": { actions: "forwardRouteSync" },
    "online-changed": { actions: "changeOnline" },
    "draft-persist-requested": { actions: "forwardDraftPersistence" },
    "draft-restored": { actions: "restoreDraft" },
    "draft-hydrated": { actions: "markDraftHydrated" },
    "browser-state-failed": { actions: "reportFailure" },
  },
});
