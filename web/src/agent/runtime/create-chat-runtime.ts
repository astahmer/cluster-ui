import { createActor, type ActorRefFrom } from "xstate";

import type { ChatMessage } from "../protocol/messages.ts";
import type { ModelConfiguration } from "../protocol/model.ts";
import type { MemorySummary } from "../protocol/resources.ts";
import { defaultGenericChatSettings } from "../chat/settings.ts";
import { genericChatAppMachine } from "../chat-runtime/generic-chat-app-machine.ts";
import {
  createConversationClient,
  type Conversation,
  type ConversationThread,
  type Memory,
} from "../chat-runtime/conversation-client.ts";
import type { ChatSession, ChatSessionEvent, QueuedFollowUp } from "../chat-session-machine.ts";
import type { GenericChatSettings } from "../chat/settings.ts";

import type {
  ConversationStoreActorEvent,
  ConversationStoreContext,
} from "../chat-runtime/conversation-store-actor.ts";
import type {
  SettingsActorEvent,
  SettingsActorContext,
} from "../chat-runtime/settings-actor.ts";
import type { BrowserStateContext } from "../chat-runtime/browser-state-actor.ts";
import type { ChatUiActorEvent, ChatUiContext } from "../chat-runtime/chat-ui-actor.ts";
import type {
  ChatApprovalDecision,
  ChatTransportActorEvent,
} from "../chat-runtime/transport-types.ts";
import type {
  ChatActions,
  ChatRuntime,
  ChatRuntimeOptions,
  ChatSettingsState,
  ChatState,
  Selector,
  SuggestionsState,
} from "./types.ts";

type RuntimeActor = ActorRefFrom<typeof genericChatAppMachine>;
type RuntimeChildContexts = {
  session: ChatSession;
  transport: never;
  conversationStore: ConversationStoreContext;
  settings: SettingsActorContext;
  browserState: BrowserStateContext;
  chatUi: ChatUiContext;
  suggestions: SuggestionsState;
};
type ChildSnapshot<Context> = {
  readonly context: Context;
  readonly matches: (value: string) => boolean;
};
type ChildSubscriptionSource = {
  subscribe: (listener: () => void) => { unsubscribe: () => void };
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "");

const originFromBaseUrl = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "";
  }
};

const chatApiFromBaseUrl = (baseUrl: string): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/chat") ? normalized : `${normalized}/chat`;
};

const asSettings = (settings: GenericChatSettings): ChatSettingsState => ({ ...settings });

const settingsPatchFromModel = (model: ModelConfiguration): Partial<GenericChatSettings> => ({
  model: model.model,
  ...(model.provider === undefined ? {} : { provider: model.provider }),
});

const conversationToProtocol = (conversation: Conversation) => ({
  id: conversation.id,
  title: conversation.title,
  status: conversation.status,
  pinned: conversation.pinned,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const threadToProtocol = (thread: ConversationThread) => ({
  id: thread.id,
  conversationId: thread.conversationId,
  anchorMessageId: thread.anchorMessageId,
  title: thread.title,
  status: thread.status,
  pinned: thread.pinned,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
});

const memoryToProtocol = (memory: Memory) => ({
  id: memory.id,
  content: memory.content,
  source: memory.source,
  threadId: memory.threadId,
  createdAt: memory.createdAt,
  rank: memory.rank,
});

const createStorageAdapter = (storage: ChatRuntimeOptions["storage"]["settings"]) => ({
  getItem: (key: string) => storage.get(key),
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.remove(key),
});

const requestBody = ({
  settings,
  request,
  createRequestBody,
}: {
  settings: GenericChatSettings;
  request: {
    conversationId: string | undefined;
    threadId: string | undefined;
    temporary: boolean;
    messages: ReadonlyArray<ChatMessage>;
    text: string;
    files: ReadonlyArray<import("../protocol/parts.ts").Attachment>;
  };
  createRequestBody: ChatRuntimeOptions["transport"]["requestBody"];
}): Record<string, unknown> => {
  if (createRequestBody !== undefined) return createRequestBody({ settings, ...request });
  return {
    system: settings.systemPrompt === "" ? undefined : settings.systemPrompt,
    config: {
      provider: settings.provider,
      apiKey: settings.apiKey,
      ...(settings.baseUrl === "" ? {} : { baseUrl: settings.baseUrl }),
      model: settings.model,
    },
    memory: {
      enabled: settings.memoryEnabled,
      ...(settings.memoryModel === "" ? {} : { model: settings.memoryModel }),
    },
    title: {
      ...(settings.titleModel === "" ? {} : { model: settings.titleModel }),
      ...(settings.titlePrompt === "" ? {} : { prompt: settings.titlePrompt }),
    },
    webSearch: settings.webSearch,
  };
};

const messageText = (message: ChatMessage): string =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

const messageFiles = (message: ChatMessage) =>
  message.parts.flatMap((part) => (part.type === "file" ? [part.file] : []));

const buildDefaults = (
  model: ModelConfiguration | undefined,
  defaults: GenericChatSettings | undefined,
): GenericChatSettings => ({
  ...defaultGenericChatSettings,
  ...defaults,
  ...(model === undefined ? {} : { model: model.model }),
});

const defaultSettingsStorageKey = "emi-core-chat-settings";

export const createChatRuntimeActor = (options: ChatRuntimeOptions): RuntimeActor => {
  const settingsStorage = createStorageAdapter(options.storage.settings);
  const draftsStorage = createStorageAdapter(options.storage.drafts);
  const settingsStorageKey = options.storage.keys?.settings ?? defaultSettingsStorageKey;
  const draftStorageKey = options.storage.keys?.drafts ?? `${settingsStorageKey}:draft`;
  const normalizedBaseUrl = normalizeBaseUrl(options.transport.baseUrl);
  const client =
    options.persistence ??
    createConversationClient({
      apiOrigin: originFromBaseUrl(normalizedBaseUrl),
      fetch: options.transport.fetch,
    });
  return createActor(genericChatAppMachine, {
    input: {
      api: chatApiFromBaseUrl(normalizedBaseUrl),
      fetch: options.transport.fetch,
      createConversation: options.transport.createConversation,
      createId: options.identity.createId,
      now: options.identity.now,
      streamInactivityTimeoutMilliseconds: options.transport.streamInactivityTimeoutMilliseconds,
      streamDecoder: options.transport.streamDecoder,
      errorDecoder: options.transport.errorDecoder,
      messageEncoder: options.transport.messageEncoder,
      client,
      storage: settingsStorage,
      storageKey: settingsStorageKey,
      defaults: buildDefaults(options.model, options.settings?.defaults),
      browser: {
        online: () => options.browser.online,
        subscribeOnline: options.browser.subscribeOnline,
        subscribeStorage: options.browser.subscribeStorage,
        storage: draftsStorage,
      },
      draftStorageKey,
      features: {
        suggestions: options.features?.suggestions ?? false,
      },
      queueSync: options.queueSync,
      onSessionCreated: options.lifecycle?.onSessionCreated,
      onHistoryChanged: options.lifecycle?.onHistoryChanged,
      onStreamCompleted: options.lifecycle?.onStreamCompleted,
    },
  });
};

export const createChatRuntime = (options: ChatRuntimeOptions): ChatRuntime => {
  // Armed approval decision consumed by the next encoder invocation.
  let armedApprovalDecision: ChatApprovalDecision | undefined;
  const userEncoder = options.transport.messageEncoder;
  const transportWithApprovals: ChatRuntimeOptions["transport"] = {
    ...options.transport,
    messageEncoder:
      userEncoder === undefined
        ? undefined
        : (input) => {
            const decision = armedApprovalDecision;
            armedApprovalDecision = undefined;
            return userEncoder({ ...input, approvalDecision: decision });
          },
  };
  const wiredOptions: ChatRuntimeOptions = { ...options, transport: transportWithApprovals };
  let forceSendQueuedFollowUpFromQueue: (input: { readonly id: string }) => void = () => {};
  const actor = createChatRuntimeActor(
    options.queueSync === undefined
      ? wiredOptions
      : {
          ...wiredOptions,
          queueSync: {
            ...options.queueSync,
            onForceSend: (input) => forceSendQueuedFollowUpFromQueue(input),
          },
        },
  );

  const listeners = new Set<() => void>();
  const childSubscriptions = new Map<string, { unsubscribe: () => void }>();
  let cachedActorSnapshot: ReturnType<RuntimeActor["getSnapshot"]> | undefined;
  let cachedState: ChatState | undefined;
  let started = false;
  let stopped = false;
  let disposed = false;
  let wasStreaming = false;
  let drainScheduled = false;
  let autoDrainQueuedFollowUps = false;
  let drainQueuedFollowUp = () => undefined;
  let lastRetryAt = 0;
  let lastForwardedDraft: string | undefined;

  const invalidate = () => {
    const sessionSnapshot = actor.getSnapshot().children.session?.getSnapshot();
    const draft = sessionSnapshot?.context.draft;
    if (started && draft !== undefined) {
      if (lastForwardedDraft === undefined) {
        // First observation is a baseline, not a change: forwarding it would
        // race the initial hydration and erase a legitimately saved draft.
        lastForwardedDraft = draft;
      } else if (draft !== lastForwardedDraft) {
        // Programmatic clears (send, queueing, edit-discard) are silent assigns
        // without a draft-changed event; forward every transition so the
        // saved-draft storage can never keep a stale message.
        lastForwardedDraft = draft;
        actor.send({
          type: "browser-state-event",
          event: { type: "draft-persist-requested", draft },
        });
      }
    }
    const isStreaming = sessionSnapshot?.matches("streaming") ?? false;
    const shouldDrain =
      autoDrainQueuedFollowUps &&
      wasStreaming &&
      !isStreaming &&
      (sessionSnapshot?.context.streamOutcome === "completed" ||
        sessionSnapshot?.context.streamOutcome === "cancelled");
    wasStreaming = isStreaming;
    cachedActorSnapshot = undefined;
    cachedState = undefined;
    for (const listener of listeners) listener();
    if (shouldDrain && !drainScheduled) {
      drainScheduled = true;
      queueMicrotask(() => {
        drainScheduled = false;
        drainQueuedFollowUp();
      });
    }
  };
  const actorSubscription = actor.subscribe(invalidate);

  const subscribeToChildren = () => {
    for (const [key, child] of Object.entries(actor.getSnapshot().children)) {
      if (childSubscriptions.has(key)) continue;
      const source = child as unknown as ChildSubscriptionSource;
      childSubscriptions.set(key, source.subscribe(invalidate));
    }
  };

  const unsubscribeFromChildren = () => {
    for (const subscription of childSubscriptions.values()) subscription.unsubscribe();
    childSubscriptions.clear();
  };

  const childSnapshot = <Key extends keyof RuntimeChildContexts>(
    key: Key,
  ): ChildSnapshot<RuntimeChildContexts[Key]> | undefined => {
    const child = actor.getSnapshot().children[key];
    if (child === undefined) return undefined;
    const snapshot = child.getSnapshot();
    if (!("context" in snapshot)) return undefined;
    return snapshot as unknown as ChildSnapshot<RuntimeChildContexts[Key]>;
  };

  const currentSession = (): ChatSession => {
    const snapshot = childSnapshot("session");
    return (
      snapshot?.context ?? {
        conversationId: undefined,
        threadId: undefined,
        messages: [],
        resumeMessageId: undefined,
        streamMessageId: undefined,
        failedStreamMessageId: undefined,
        streamOrigin: undefined,
        streamOutcome: undefined,
        sendPending: false,
        sendGrace: false,
        draft: "",
        files: [],
        temporary: false,
        error: undefined,
        queuedFollowUps: [],
        errorMessageId: undefined,
      }
    );
  };

  const sendSession = (event: ChatSessionEvent) => {
    if (!disposed) actor.send({ type: "session-event", event });
  };

  const sendConversationStore = (event: ConversationStoreActorEvent) => {
    if (!disposed) actor.send({ type: "conversation-store-event", event });
  };

  const sendSettings = (event: SettingsActorEvent) => {
    if (!disposed) actor.send({ type: "settings-event", event });
  };

  const sendChatUi = (event: ChatUiActorEvent) => {
    if (!disposed) actor.send({ type: "chat-ui-event", event });
  };

  const sendTransport = (event: ChatTransportActorEvent) => {
    if (!disposed) actor.send({ type: "transport-event", event });
  };

  const currentSettings = (): GenericChatSettings => {
    const snapshot = childSnapshot("settings");
    return snapshot?.context.settings ?? defaultGenericChatSettings;
  };

  const currentStore = (): Pick<
    ConversationStoreContext,
    "conversations" | "threads" | "memories" | "memorySummary" | "loading" | "error"
  > => {
    const snapshot = childSnapshot("conversationStore");
    return (
      snapshot?.context ?? {
        conversations: [] as Conversation[],
        threads: [] as ConversationThread[],
        memories: [] as Memory[],
        memorySummary: undefined as MemorySummary | undefined,
        loading: {
          conversations: false,
          conversation: false,
          threads: false,
          thread: false,
          memories: false,
          mutation: false,
        },
        error: undefined as string | undefined,
      }
    );
  };

  const currentBrowser = (): Pick<BrowserStateContext, "online" | "error"> => {
    const snapshot = childSnapshot("browserState");
    return snapshot?.context ?? { online: options.browser.online, error: undefined };
  };

  const currentUi = (): ChatUiContext => {
    const snapshot = childSnapshot("chatUi");
    return (
      snapshot?.context ?? {
        conversationSearch: "",
        memorySearch: "",
        memoryDraft: "",
        memorySummaryDraft: undefined,
        memorySummaryDirty: false,
        memoryPanelOpen: false,
        sidebarOpen: true,
        editingQueuedFollowUpId: undefined,
      }
    );
  };

  const currentSuggestions = (): SuggestionsState => {
    const snapshot = childSnapshot("suggestions");
    return (
      snapshot?.context ?? {
        items: [],
        loading: false,
        error: undefined,
      }
    );
  };

  const stateFromActor = (): ChatState => {
    const session = currentSession();
    const store = currentStore();
    const settings = currentSettings();
    const browser = currentBrowser();
    const ui = currentUi();
    const suggestions = currentSuggestions();
    const activeConversation = store.conversations.find(
      (conversation) => conversation.id === session.conversationId,
    );
    const isStreaming = childSnapshot("session")?.matches("streaming") ?? false;
    const activeThreadMessages: ChatMessage[] = session.messages;
    return {
      activeConversation:
        activeConversation === undefined ? undefined : conversationToProtocol(activeConversation),
      activeThread: {
        id: session.threadId,
        conversationId: session.conversationId,
        messages: activeThreadMessages,
        isStreaming,
        isSending: session.sendPending,
        isSendGraceActive: isStreaming && session.sendGrace,
      },
      composer: {
        text: session.draft,
        attachments: session.files,
        canSend: browser.online && (session.draft.trim() !== "" || session.files.length > 0),
      },
      conversations: {
        items: store.conversations.map(conversationToProtocol),
        search: ui.conversationSearch,
        loading: store.loading.conversations,
        error: store.error,
      },
      memories: {
        items: store.memories.map(memoryToProtocol),
        summary: store.memorySummary,
        search: ui.memorySearch,
        loading: store.loading.memories,
        error: store.error,
      },
      settings: asSettings(settings),
      connection: browser.online ? "online" : "offline",
      temporary: session.temporary,
      queuedFollowUps: session.queuedFollowUps.map((followUp) => ({
        id: followUp.id,
        text: followUp.text,
        attachments: followUp.files,
      })),
      error: session.error ?? store.error ?? currentBrowser().error ?? undefined,
      errorMessageId: session.errorMessageId,
      ui: {
        conversationSearch: ui.conversationSearch,
        memorySearch: ui.memorySearch,
        memoryDraft: ui.memoryDraft,
        memorySummaryDraft: ui.memorySummaryDraft,
        memoryPanelOpen: ui.memoryPanelOpen,
        sidebarOpen: ui.sidebarOpen,
        editingQueuedFollowUpId: ui.editingQueuedFollowUpId,
      },
      threads: store.threads.map(threadToProtocol),
      suggestions,
    };
  };

  const getState = (): ChatState => {
    if (disposed && cachedState !== undefined) return cachedState;
    const snapshot = actor.getSnapshot();
    if (snapshot === cachedActorSnapshot && cachedState !== undefined) return cachedState;
    cachedActorSnapshot = snapshot;
    cachedState = stateFromActor();
    return cachedState;
  };

  const activeConversationId = (inputId: string | undefined): string | undefined =>
    inputId ?? currentSession().conversationId;

  const sendMessage: ChatActions["sendMessage"] = ({ text, attachments }) => {
    const session = currentSession();
    const settings = currentSettings();
    const browser = currentBrowser();
    if (!browser.online) {
      sendSession({
        type: "error-reported",
        error: "You are offline. Your draft is saved locally until you reconnect.",
      });
      return;
    }
    const files = attachments === undefined ? session.files : [...attachments];
    if (text.trim() === "" && files.length === 0) return;
    if (childSnapshot("session")?.matches("streaming")) {
      autoDrainQueuedFollowUps = true;
      sendSession({
        type: "follow-up-queued",
        followUp: { id: options.identity.createId(), text, files },
      });
      return;
    }
    if (settings.apiKey.trim() === "") {
      sendSession({
        type: "error-reported",
        error: "Add an API key in settings before sending a message.",
      });
      return;
    }
    sendTransport({
      type: "stream-send-requested",
      request: {
        conversationId: session.conversationId,
        threadId: session.threadId,
        temporary: session.temporary,
        messages: session.messages,
        text,
        files,
        body: requestBody({
          settings,
          request: {
            conversationId: session.conversationId,
            threadId: session.threadId,
            temporary: session.temporary,
            messages: session.messages,
            text,
            files,
          },
          createRequestBody: options.transport.requestBody,
        }),
      },
    });
  };

  /**
   * Resume a tool run paused on `needsApproval`: arm the decision for the
   * encoder, then re-send the current history without new user text. The
   * server resumes the paused tool from the appended approval response.
   */
  const approveToolCall: ChatActions["approveToolCall"] = ({ approvalId, approved }) => {
    const session = currentSession();
    const settings = currentSettings();
    if (childSnapshot("session")?.matches("streaming")) return;
    armedApprovalDecision = { approvalId, approved };
    sendTransport({
      type: "stream-send-requested",
      request: {
        conversationId: session.conversationId,
        threadId: session.threadId,
        temporary: session.temporary,
        messages: session.messages,
        text: "",
        files: [],
        body: requestBody({
          settings,
          request: {
            conversationId: session.conversationId,
            threadId: session.threadId,
            temporary: session.temporary,
            messages: session.messages,
            text: "",
            files: [],
          },
          createRequestBody: options.transport.requestBody,
        }),
      },
    });
  };

  const sendRevision = ({ messageId, text }: { messageId: string; text: string }) => {
    const session = currentSession();
    const settings = currentSettings();
    const browser = currentBrowser();
    if (!browser.online) {
      sendSession({
        type: "error-reported",
        error: "You are offline. Your draft is saved locally until you reconnect.",
      });
      return;
    }
    if (settings.apiKey.trim() === "") {
      sendSession({
        type: "error-reported",
        error: "Add an API key in settings before sending a message.",
      });
      return;
    }
    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      sendSession({ type: "error-reported", error: "Message no longer exists." });
      return;
    }
    const target = session.messages[targetIndex];
    if (target === undefined || target.role !== "user") {
      sendSession({ type: "error-reported", error: "Only user messages can be revised." });
      return;
    }
    if (session.conversationId === undefined || session.temporary) {
      sendSession({ type: "error-reported", error: "Only saved conversations can be revised." });
      return;
    }
    if (text.trim() === "" && messageFiles(target).length === 0) return;
    const files = messageFiles(target);
    const revisedParts = [
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
      ...files.map((file) => ({ type: "file" as const, file })),
    ];
    sendConversationStore({
      type: "conversation-message-revision-requested",
      conversationId: session.conversationId,
      messageId: target.id,
      parts: revisedParts,
      ...(session.threadId === undefined ? {} : { threadId: session.threadId }),
      request: {
        conversationId: session.conversationId,
        threadId: session.threadId,
        temporary: false,
        messages: session.messages.slice(0, targetIndex),
        text,
        files,
        messageId: target.id,
        replaceMessageId: target.id,
        body: requestBody({
          settings,
          request: {
            conversationId: session.conversationId,
            threadId: session.threadId,
            temporary: false,
            messages: session.messages.slice(0, targetIndex),
            text,
            files: messageFiles(target),
          },
          createRequestBody: options.transport.requestBody,
        }),
      },
    });
  };

  const retryMessage = ({ messageId }: { messageId: string }) => {
    const now = Date.parse(options.identity.now());
    if (now - lastRetryAt < 750) return;
    lastRetryAt = now;
    const session = currentSession();
    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      sendSession({ type: "error-reported", error: "Message no longer exists." });
      return;
    }
    const target = session.messages[targetIndex];
    const userIndex =
      target?.role === "user"
        ? targetIndex
        : session.messages.findLastIndex(
            (message, index) => index < targetIndex && message.role === "user",
          );
    const userMessage = userIndex === -1 ? undefined : session.messages[userIndex];
    if (userMessage === undefined) {
      sendSession({ type: "error-reported", error: "No user message is available to retry." });
      return;
    }
    sendRevision({ messageId: userMessage.id, text: messageText(userMessage) });
  };

  const sendQueuedFollowUp = ({ followUp }: { followUp: QueuedFollowUp }) => {
    const session = currentSession();
    sendTransport({
      type: "queued-follow-up-force-requested",
      followUp,
      request: {
        conversationId: session.conversationId,
        threadId: session.threadId,
        temporary: session.temporary,
        messages: session.messages,
        body: requestBody({
          settings: currentSettings(),
          request: {
            conversationId: session.conversationId,
            threadId: session.threadId,
            temporary: session.temporary,
            messages: session.messages,
            text: followUp.text,
            files: followUp.files,
          },
          createRequestBody: options.transport.requestBody,
        }),
      },
    });
  };

  const forceSendQueuedFollowUpNow = ({ id }: { readonly id: string }) => {
    const session = currentSession();
    const followUp = session.queuedFollowUps.find((item) => item.id === id);
    if (followUp === undefined) return;
    if (currentUi().editingQueuedFollowUpId === id)
      sendChatUi({ type: "queued-follow-up-edit-cleared" });
    sendQueuedFollowUp({ followUp });
  };

  forceSendQueuedFollowUpFromQueue = forceSendQueuedFollowUpNow;

  drainQueuedFollowUp = () => {
    const session = currentSession();
    const followUp = session.queuedFollowUps[0];
    if (followUp === undefined) {
      autoDrainQueuedFollowUps = false;
      return;
    }
    if (childSnapshot("session")?.matches("streaming")) return;
    sendQueuedFollowUp({ followUp });
  };

  const actions: ChatActions = {
    sendMessage,
    approveToolCall,
    stop: () => sendTransport({ type: "stream-cancelled" }),
    retry: retryMessage,
    editMessage: ({ messageId, text }) => sendRevision({ messageId, text }),
    selectConversation: ({ conversationId }) => {
      sendChatUi({ type: "queued-follow-up-edit-cleared" });
      sendConversationStore({ type: "conversation-load-requested", conversationId });
    },
    selectThread: ({ threadId }) => {
      const conversationId = currentSession().conversationId;
      if (conversationId !== undefined) {
        sendChatUi({ type: "queued-follow-up-edit-cleared" });
        sendConversationStore({ type: "thread-load-requested", conversationId, threadId });
      }
    },
    updateConversation: ({ conversationId, title, status, pinned }) => {
      const id = activeConversationId(conversationId);
      if (id === undefined) return;
      sendConversationStore({
        type: "conversation-update-requested",
        conversationId: id,
        patch: {
          ...(title === undefined ? {} : { title }),
          ...(status === undefined ? {} : { status }),
          ...(pinned === undefined ? {} : { pinned }),
        },
      });
    },
    deleteConversation: ({ conversationId, resetSession }) =>
      sendConversationStore({
        type: "conversation-delete-requested",
        conversationId,
        resetSession,
      }),
    cloneConversation: ({ conversationId }) =>
      sendConversationStore({ type: "conversation-clone-requested", conversationId }),
    compactConversation: ({ conversationId }) => {
      const settings = currentSettings();
      if (settings.apiKey.trim() === "") {
        sendSession({
          type: "error-reported",
          error: "Add an API key in settings before compacting a conversation.",
        });
        return;
      }
      sendConversationStore({
        type: "conversation-compact-requested",
        conversationId,
        config: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          ...(settings.baseUrl === "" ? {} : { baseUrl: settings.baseUrl }),
          model: settings.model,
        },
      });
    },
    updateSettings: ({ model, patch }) =>
      sendSettings({
        type: "settings-patch-requested",
        patch: Object.assign({}, patch, model === undefined ? {} : settingsPatchFromModel(model)),
      }),
    setWebSearch: ({ enabled }) =>
      sendSettings({
        type: "settings-patch-requested",
        patch: { webSearch: enabled },
      }),
    setDraft: ({ text }) => sendSession({ type: "draft-changed", draft: text }),
    addAttachments: ({ attachments }) =>
      sendSession({ type: "files-added", files: [...attachments] }),
    removeAttachment: ({ attachmentId }) => {
      const files = currentSession().files.filter(
        (file) => `attachment:${file.url}` !== attachmentId,
      );
      sendSession({ type: "files-changed", files });
    },
    startNewConversation: () => {
      autoDrainQueuedFollowUps = false;
      sendTransport({ type: "stream-cancelled" });
      sendSession({ type: "fresh-started" });
      sendChatUi({ type: "queued-follow-up-edit-cleared" });
      sendConversationStore({ type: "threads-cleared" });
    },
    createBranch: ({ messageId }) => {
      const session = currentSession();
      if (session.conversationId === undefined || session.temporary) return;
      sendConversationStore({
        type: "thread-create-requested",
        conversationId: session.conversationId,
        anchorMessageId: messageId,
      });
    },
    setTemporary: ({ temporary }) => sendSession({ type: "temporary-changed", temporary }),
    syncRoute: (route) => {
      autoDrainQueuedFollowUps = false;
      actor.send({ type: "route-sync-requested", route });
    },
    forceSendQueuedFollowUp: ({ id }) => {
      const session = currentSession();
      const syncEligible =
        options.queueSync !== undefined &&
        !session.temporary &&
        session.conversationId !== undefined;
      if (!syncEligible) {
        forceSendQueuedFollowUpNow({ id });
        return;
      }
      if (!disposed) actor.send({ type: "queue-force-send-requested", id });
    },
    updateQueuedFollowUp: ({ id, text, attachments }) =>
      sendSession({ type: "queued-follow-up-updated", id, text, files: [...attachments] }),
    replaceQueuedFollowUps: ({ items }) =>
      sendSession({
        type: "queued-follow-ups-replaced",
        items: items.map((item) => ({
          id: item.id,
          text: item.text,
          files: [...item.attachments],
        })),
      }),
    removeQueuedFollowUp: ({ id }) => {
      sendSession({ type: "queued-follow-up-removed", id });
      if (currentUi().editingQueuedFollowUpId === id)
        sendChatUi({ type: "queued-follow-up-edit-cleared" });
    },
    beginEditingQueuedFollowUp: ({ id }) =>
      sendChatUi({ type: "queued-follow-up-edit-started", id }),
    clearQueuedFollowUpEdit: () => sendChatUi({ type: "queued-follow-up-edit-cleared" }),
    beginQueuedFollowUpEditWithDraft: ({ id }) => {
      const followUp = currentSession().queuedFollowUps.find((item) => item.id === id);
      if (followUp === undefined) return;
      sendSession({
        type: "files-changed",
        files: [],
      });
      sendChatUi({ type: "queued-follow-up-edit-started", id });
      sendSession({ type: "draft-changed", draft: followUp.text });
      sendSession({ type: "files-added", files: [...followUp.files] });
    },
    commitQueuedFollowUpEdit: ({ id, text, attachments }) => {
      const session = currentSession();
      if (session.queuedFollowUps.some((item) => item.id === id)) {
        sendSession({ type: "queued-follow-up-updated", id, text, files: [...attachments] });
      }
      if (session.files.length > 0) sendSession({ type: "files-changed", files: [] });
      sendChatUi({ type: "queued-follow-up-edit-cleared" });
      sendSession({ type: "draft-changed", draft: "" });
    },
    discardQueuedFollowUpEdit: () => {
      if (currentSession().files.length > 0) sendSession({ type: "files-changed", files: [] });
      sendChatUi({ type: "queued-follow-up-edit-cleared" });
      sendSession({ type: "draft-changed", draft: "" });
    },
    setConversationSearch: ({ search }) => {
      sendChatUi({ type: "conversation-search-changed", search });
      sendConversationStore({ type: "conversations-load-requested", search });
    },
    setMemorySearch: ({ search }) => {
      sendChatUi({ type: "memory-search-changed", search });
      sendConversationStore({ type: "memory-load-requested", search });
    },
    setMemoryDraft: ({ draft }) => sendChatUi({ type: "memory-draft-changed", draft }),
    setMemorySummaryDraft: ({ draft }) =>
      sendChatUi({ type: "memory-summary-draft-changed", draft }),
    setMemoryPanelOpen: ({ open }) => sendChatUi({ type: "memory-panel-changed", open }),
    setSidebarOpen: ({ open }) => sendChatUi({ type: "sidebar-open-changed", open }),
    createMemory: () => {
      const ui = currentUi();
      const content = ui.memoryDraft.trim();
      if (content === "") return;
      sendConversationStore({ type: "memory-create-requested", content, search: ui.memorySearch });
      sendChatUi({ type: "memory-draft-cleared" });
    },
    saveMemorySummary: () => {
      const ui = currentUi();
      const content = (ui.memorySummaryDraft ?? currentStore().memorySummary?.content ?? "").trim();
      if (content === "") return;
      sendConversationStore({ type: "memory-summary-update-requested", content });
    },
    deleteMemory: ({ memoryId }) =>
      sendConversationStore({ type: "memory-delete-requested", memoryId }),
    reportError: ({ error }) => sendSession({ type: "error-reported", error }),
    clearError: () => sendSession({ type: "error-cleared" }),
  };

  const selectors = {
    activeConversation: ((state) => state.activeConversation) as Selector<
      ChatState["activeConversation"]
    >,
    activeThread: ((state) => state.activeThread) as Selector<ChatState["activeThread"]>,
    composer: ((state) => state.composer) as Selector<ChatState["composer"]>,
    conversations: ((state) => state.conversations) as Selector<ChatState["conversations"]>,
    memories: ((state) => state.memories) as Selector<ChatState["memories"]>,
    settings: ((state) => state.settings) as Selector<ChatState["settings"]>,
    connection: ((state) => state.connection) as Selector<ChatState["connection"]>,
    suggestions: ((state) => state.suggestions) as Selector<ChatState["suggestions"]>,
  };

  const start = () => {
    if (disposed || started || stopped) return;
    started = true;
    actor.start();
    subscribeToChildren();
  };

  const stop = () => {
    if (disposed || !started || stopped) return;
    stopped = true;
    unsubscribeFromChildren();
    actor.stop();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (started && !stopped) {
      stopped = true;
      unsubscribeFromChildren();
      actor.stop();
    }
    actorSubscription.unsubscribe();
    listeners.clear();
  };

  const subscribe = (listener: () => void) => {
    if (disposed) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { selectors, actions, getState, start, stop, dispose, subscribe };
};
