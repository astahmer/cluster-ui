import { assign, fromCallback, sendTo, setup } from "xstate";

import type { ChatModelConfiguration } from "../chat/request.ts";
import type { SuggestionsState } from "../runtime/types.ts";
import type { ConversationClient } from "./conversation-client.ts";

export interface SuggestionsActorInput {
  readonly client: ConversationClient;
  readonly enabled: boolean;
}

export type SuggestionsActorEvent =
  | {
      type: "suggestions-requested";
      lastAssistantText: string;
      lastUserText: string | undefined;
      threadId: string | undefined;
      messageId: string | undefined;
      config: ChatModelConfiguration;
    }
  | { type: "suggestions-loaded"; items: string[] }
  | { type: "suggestions-failed"; error: string }
  | { type: "suggestions-cleared" };

const suggestionOperations = fromCallback<SuggestionsActorEvent, SuggestionsActorInput>(
  ({ input, receive, sendBack }) => {
    receive((event) => {
      if (!input.enabled || event.type !== "suggestions-requested") return;
      void input.client
        .generateSuggestions({
          lastAssistantText: event.lastAssistantText,
          ...(event.lastUserText === undefined ? {} : { lastUserText: event.lastUserText }),
          ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
          ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
          config: event.config,
        })
        .then(
          (items) => sendBack({ type: "suggestions-loaded", items }),
          (cause: unknown) =>
            sendBack({
              type: "suggestions-failed",
              error: cause instanceof Error ? cause.message : "Unable to load suggestions.",
            }),
        );
    });
  },
);

const initialSuggestionsState: SuggestionsState = {
  items: [],
  loading: false,
  error: undefined,
};

export const suggestionsActor = setup({
  types: {
    context: {} as SuggestionsState & SuggestionsActorInput,
    input: {} as SuggestionsActorInput,
    events: {} as SuggestionsActorEvent,
  },
  actors: { operations: suggestionOperations },
  actions: {
    requestSuggestions: assign({ items: [], loading: true, error: undefined }),
    receiveSuggestions: assign(({ event }) =>
      event.type === "suggestions-loaded"
        ? { items: event.items, loading: false, error: undefined }
        : {},
    ),
    reportFailure: assign(({ event }) =>
      event.type === "suggestions-failed" ? { items: [], loading: false, error: event.error } : {},
    ),
    clearSuggestions: assign({ items: [], loading: false, error: undefined }),
    forwardOperation: sendTo("operations", ({ event }) => event),
  },
}).createMachine({
  id: "suggestions",
  context: ({ input }) => ({ ...input, ...initialSuggestionsState }),
  invoke: {
    id: "operations",
    src: "operations",
    input: ({ context }) => ({ client: context.client, enabled: context.enabled }),
  },
  on: {
    "suggestions-requested": { actions: ["requestSuggestions", "forwardOperation"] },
    "suggestions-loaded": { actions: "receiveSuggestions" },
    "suggestions-failed": { actions: "reportFailure" },
    "suggestions-cleared": { actions: "clearSuggestions" },
  },
});
