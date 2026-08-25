import { sendTo, setup } from "xstate";

import { chatSessionMachine, type ChatSessionEvent } from "../chat-session-machine.ts";
import type { ChatRouteInput } from "../runtime/types.ts";
import { chatTransportActor } from "./chat-transport-actor.ts";
import type { ChatTransportActorEvent, ChatTransportActorInput } from "./transport-types.ts";
import {
  conversationStoreActor,
  type ConversationStoreActorEvent,
  type ConversationStoreActorInput,
} from "./conversation-store-actor.ts";
import {
  browserStateActor,
  type BrowserStateActorEvent,
  type BrowserStateActorInput,
} from "./browser-state-actor.ts";
import { chatUiActor, type ChatUiActorEvent } from "./chat-ui-actor.ts";
import {
  settingsActor,
  type SettingsActorEvent,
  type SettingsActorInput,
} from "./settings-actor.ts";
import {
  suggestionsActor,
  type SuggestionsActorEvent,
  type SuggestionsActorInput,
} from "./suggestions-actor.ts";
import {
  chatLifecycleActor,
  type ChatLifecycleActorEvent,
  type ChatLifecycleActorInput,
} from "./chat-lifecycle-actor.ts";
import { followUpQueueActor, type FollowUpQueueActorInput } from "./follow-up-queue-actor.ts";

const invalidForwardingEvent = (): never => {
  throw new Error("Generic chat app received an invalid forwarding event.");
};

export interface GenericChatAppInput
  extends
    Pick<
      ChatTransportActorInput,
      | "api"
      | "createConversation"
      | "createId"
      | "fetch"
      | "now"
      | "streamInactivityTimeoutMilliseconds"
      | "streamDecoder"
      | "errorDecoder"
      | "messageEncoder"
    >,
    Pick<ConversationStoreActorInput, "client">,
    Pick<SettingsActorInput, "storage" | "storageKey" | "defaults">,
    Pick<BrowserStateActorInput, "browser" | "draftStorageKey">,
    Pick<ChatLifecycleActorInput, "onSessionCreated" | "onHistoryChanged" | "onStreamCompleted"> {
  readonly features?: {
    readonly suggestions?: boolean;
  };
  readonly queueSync?: Pick<FollowUpQueueActorInput, "adapter" | "onForceSend">;
}

export type GenericChatAppEvent =
  | { type: "session-event"; event: ChatSessionEvent }
  | { type: "transport-event"; event: ChatTransportActorEvent }
  | { type: "conversation-store-event"; event: ConversationStoreActorEvent }
  | { type: "transport-session-event"; event: ChatSessionEvent }
  | { type: "conversation-store-session-event"; event: ChatSessionEvent }
  | { type: "conversation-store-transport-event"; event: ChatTransportActorEvent }
  | { type: "settings-event"; event: SettingsActorEvent }
  | { type: "browser-state-event"; event: BrowserStateActorEvent }
  | { type: "browser-state-session-event"; event: ChatSessionEvent }
  | { type: "chat-ui-event"; event: ChatUiActorEvent }
  | { type: "suggestions-event"; event: SuggestionsActorEvent }
  | { type: "lifecycle-event"; event: ChatLifecycleActorEvent }
  | { type: "lifecycle-session-command"; event: ChatSessionEvent }
  | { type: "lifecycle-transport-command"; event: ChatTransportActorEvent }
  | { type: "lifecycle-conversation-store-command"; event: ConversationStoreActorEvent }
  | { type: "lifecycle-chat-ui-command"; event: ChatUiActorEvent }
  | { type: "route-sync-requested"; route: ChatRouteInput }
  | { type: "queue-session-command"; event: ChatSessionEvent }
  | { type: "queue-force-send-requested"; id: string };

export const genericChatAppMachine = setup({
  types: {
    context: {} as GenericChatAppInput,
    input: {} as GenericChatAppInput,
    events: {} as GenericChatAppEvent,
  },
  actors: {
    session: chatSessionMachine,
    transport: chatTransportActor,
    conversationStore: conversationStoreActor,
    settings: settingsActor,
    browserState: browserStateActor,
    chatUi: chatUiActor,
    suggestions: suggestionsActor,
    lifecycle: chatLifecycleActor,
    followUpQueue: followUpQueueActor,
  },
  actions: {
    forwardSessionEvent: sendTo("session", ({ event }) => {
      if (event.type === "session-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardQueueForceSend: sendTo("followUpQueue", ({ event }) => {
      if (event.type === "queue-force-send-requested")
        return { type: "force-send-requested", id: event.id };
      return invalidForwardingEvent();
    }),
    forwardSessionToBrowserState: sendTo("browserState", ({ event }) => {
      if (event.type === "session-event" && event.event.type === "draft-changed")
        return { type: "draft-persist-requested", draft: event.event.draft };
      return { type: "browser-noop" };
    }),
    forwardTransportEvent: sendTo("transport", ({ event }) => {
      if (event.type === "transport-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardConversationStoreEvent: sendTo("conversationStore", ({ event }) => {
      if (event.type === "conversation-store-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardConversationStoreTransportEvent: sendTo("transport", ({ event }) => {
      if (event.type === "conversation-store-transport-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardSettingsEvent: sendTo("settings", ({ event }) => {
      if (event.type === "settings-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardBrowserStateEvent: sendTo("browserState", ({ event }) => {
      if (event.type === "browser-state-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardChatUiEvent: sendTo("chatUi", ({ event }) => {
      if (event.type === "chat-ui-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardSuggestionsEvent: sendTo("suggestions", ({ event }) => {
      if (event.type === "suggestions-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardLifecycleEvent: sendTo("lifecycle", ({ event }) => {
      if (event.type === "lifecycle-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardLifecycleSessionCommand: sendTo("session", ({ event }) => {
      if (event.type === "lifecycle-session-command") return event.event;
      return invalidForwardingEvent();
    }),
    forwardLifecycleTransportCommand: sendTo("transport", ({ event }) => {
      if (event.type === "lifecycle-transport-command") return event.event;
      return invalidForwardingEvent();
    }),
    forwardLifecycleConversationStoreCommand: sendTo("conversationStore", ({ event }) => {
      if (event.type === "lifecycle-conversation-store-command") return event.event;
      return invalidForwardingEvent();
    }),
    forwardLifecycleChatUiCommand: sendTo("chatUi", ({ event }) => {
      if (event.type === "lifecycle-chat-ui-command") return event.event;
      return invalidForwardingEvent();
    }),
    forwardSessionToLifecycle: sendTo("lifecycle", ({ event }) => {
      if (event.type === "session-event") return { type: "session-event", event: event.event };
      if (event.type === "transport-session-event")
        return { type: "session-event", event: event.event };
      if (event.type === "conversation-store-session-event")
        return { type: "session-event", event: event.event };
      if (event.type === "browser-state-session-event")
        return { type: "session-event", event: event.event };
      return invalidForwardingEvent();
    }),
    forwardRouteToLifecycle: sendTo("lifecycle", ({ event }) => {
      if (event.type === "route-sync-requested")
        return { type: "route-sync-requested", route: event.route };
      return invalidForwardingEvent();
    }),
    forwardRouteToBrowserState: sendTo("browserState", ({ event }) => {
      if (event.type === "route-sync-requested")
        return { type: "route-sync-requested", route: event.route };
      return invalidForwardingEvent();
    }),
    forwardRouteToQueue: sendTo("followUpQueue", ({ event }) => {
      if (event.type === "route-sync-requested")
        return { type: "route-sync-requested", route: event.route };
      return invalidForwardingEvent();
    }),
    forwardSessionToQueue: sendTo("followUpQueue", ({ event }) => {
      if (event.type === "session-event") return { type: "session-event", event: event.event };
      if (event.type === "transport-session-event")
        return { type: "session-event", event: event.event };
      if (event.type === "conversation-store-session-event")
        return { type: "session-event", event: event.event };
      if (event.type === "browser-state-session-event")
        return { type: "session-event", event: event.event };
      return invalidForwardingEvent();
    }),
    forwardQueueSessionCommand: sendTo("session", ({ event }) => {
      if (event.type === "queue-session-command") return event.event;
      return invalidForwardingEvent();
    }),
    forwardChildSessionEvent: sendTo("session", ({ event }) => {
      if (event.type === "transport-session-event") return event.event;
      if (event.type === "conversation-store-session-event") return event.event;
      if (event.type === "browser-state-session-event") return event.event;
      return invalidForwardingEvent();
    }),
    forwardSessionToConversationStore: sendTo("conversationStore", ({ event }) => {
      if (event.type === "transport-session-event")
        return { type: "session-event", event: event.event };
      return invalidForwardingEvent();
    }),
  },
}).createMachine({
  id: "genericChatApp",
  context: ({ input }) => input,
  invoke: [
    { id: "session", src: "session" },
    {
      id: "transport",
      src: "transport",
      input: ({ context, self }) => ({
        ...context,
        sendSession: (event) => self.send({ type: "transport-session-event", event }),
        sendSuggestions: (event) =>
          self.send({
            type: "suggestions-event",
            event: { type: "suggestions-requested", ...event },
          }),
      }),
    },
    {
      id: "conversationStore",
      src: "conversationStore",
      input: ({ context, self }) => ({
        client: context.client,
        sendSession: (event) => self.send({ type: "conversation-store-session-event", event }),
        sendTransport: (event) => self.send({ type: "conversation-store-transport-event", event }),
        sendUi: (event) => self.send({ type: "chat-ui-event", event }),
      }),
    },
    {
      id: "settings",
      src: "settings",
      input: ({ context }) => ({
        storage: context.storage,
        storageKey: context.storageKey,
        defaults: context.defaults,
      }),
    },
    {
      id: "browserState",
      src: "browserState",
      input: ({ context, self }) => ({
        browser: context.browser,
        draftStorageKey: context.draftStorageKey,
        sendSession: (event) => self.send({ type: "browser-state-session-event", event }),
      }),
    },
    { id: "chatUi", src: "chatUi" },
    {
      id: "suggestions",
      src: "suggestions",
      input: ({ context }) =>
        ({
          client: context.client,
          enabled: context.features?.suggestions ?? false,
        }) satisfies SuggestionsActorInput,
    },
    {
      id: "lifecycle",
      src: "lifecycle",
      input: ({ context, self }) => ({
        sendSession: (event) => self.send({ type: "lifecycle-session-command", event }),
        sendTransport: (event) => self.send({ type: "lifecycle-transport-command", event }),
        sendConversationStore: (event) =>
          self.send({ type: "lifecycle-conversation-store-command", event }),
        sendChatUi: (event) => self.send({ type: "lifecycle-chat-ui-command", event }),
        onSessionCreated: context.onSessionCreated,
        onHistoryChanged: context.onHistoryChanged,
        onStreamCompleted: context.onStreamCompleted,
      }),
    },
    {
      id: "followUpQueue",
      src: "followUpQueue",
      input: ({ context, self }) => ({
        adapter: context.queueSync?.adapter,
        sendSession: (event) => self.send({ type: "queue-session-command", event }),
        onForceSend: context.queueSync?.onForceSend,
      }),
    },
  ],
  on: {
    "session-event": {
      actions: [
        "forwardSessionEvent",
        "forwardSessionToBrowserState",
        "forwardSessionToLifecycle",
        "forwardSessionToQueue",
      ],
    },
    "transport-event": { actions: "forwardTransportEvent" },
    "conversation-store-event": { actions: "forwardConversationStoreEvent" },
    "transport-session-event": {
      actions: [
        "forwardChildSessionEvent",
        "forwardSessionToConversationStore",
        "forwardSessionToLifecycle",
        "forwardSessionToQueue",
      ],
    },
    "conversation-store-session-event": {
      actions: ["forwardChildSessionEvent", "forwardSessionToLifecycle", "forwardSessionToQueue"],
    },
    "conversation-store-transport-event": { actions: "forwardConversationStoreTransportEvent" },
    "settings-event": { actions: "forwardSettingsEvent" },
    "browser-state-event": { actions: "forwardBrowserStateEvent" },
    "browser-state-session-event": {
      actions: ["forwardChildSessionEvent", "forwardSessionToLifecycle", "forwardSessionToQueue"],
    },
    "chat-ui-event": { actions: "forwardChatUiEvent" },
    "suggestions-event": { actions: "forwardSuggestionsEvent" },
    "lifecycle-event": { actions: "forwardLifecycleEvent" },
    "lifecycle-session-command": { actions: "forwardLifecycleSessionCommand" },
    "lifecycle-transport-command": { actions: "forwardLifecycleTransportCommand" },
    "lifecycle-conversation-store-command": {
      actions: "forwardLifecycleConversationStoreCommand",
    },
    "lifecycle-chat-ui-command": { actions: "forwardLifecycleChatUiCommand" },
    "route-sync-requested": {
      actions: ["forwardRouteToLifecycle", "forwardRouteToBrowserState", "forwardRouteToQueue"],
    },
    "queue-session-command": { actions: "forwardQueueSessionCommand" },
    "queue-force-send-requested": { actions: "forwardQueueForceSend" },
  },
});
