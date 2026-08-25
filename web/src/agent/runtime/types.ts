import type { ChatMessage } from "../protocol/messages.ts";
import type { Attachment } from "../protocol/parts.ts";
import type { Conversation, Memory, MemorySummary, Thread } from "../protocol/resources.ts";
import type { ModelConfiguration } from "../protocol/model.ts";
import type { ChatExtension } from "../extensions.ts";
import type { GenericChatSettings } from "../chat/settings.ts";
import type { WebMcpModelContext } from "../webmcp.ts";
import type { ConversationClient } from "../chat-runtime/conversation-client.ts";
import type {
  ChatMessageEncoder,
  ChatStreamDecoder,
  ChatTransportErrorDecoder,
} from "../chat-runtime/transport-types.ts";

export interface KeyValueStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export interface ChatRouteInput {
  readonly historyReady: boolean;
  readonly sessionId: string | undefined;
  readonly threadId: string | undefined;
  readonly temporary: boolean;
}

export interface ChatQueueSyncPayload {
  readonly type: "queue.sync";
  readonly sessionId: string;
  readonly tabId: string;
  readonly revision: number;
  readonly items: ReadonlyArray<QueuedFollowUpState>;
}

export interface ChatQueueForceSendPayload {
  readonly type: "queue.force-send";
  readonly sessionId: string;
  readonly tabId: string;
  readonly itemId: string;
}

export interface ChatQueueForceSendClaimPayload {
  readonly type: "queue.force-send-claim";
  readonly sessionId: string;
  readonly tabId: string;
  readonly itemId: string;
}

export type ChatQueueSyncMessage =
  | ChatQueueSyncPayload
  | ChatQueueForceSendPayload
  | ChatQueueForceSendClaimPayload;

export interface ChatQueueSyncAdapter {
  readonly tabId: string;
  readonly read: (sessionId: string) => ChatQueueSyncPayload | null;
  readonly write: (payload: ChatQueueSyncPayload) => void;
  readonly subscribe: (
    sessionId: string,
    listener: (message: ChatQueueSyncMessage) => void,
  ) => () => void;
  readonly broadcast: (message: ChatQueueSyncMessage) => void;
}

export interface ChatRuntimeOptions {
  readonly transport: {
    readonly baseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly streamInactivityTimeoutMilliseconds?: number;
    readonly createConversation?: () => Promise<string>;
    readonly streamDecoder?: ChatStreamDecoder;
    readonly errorDecoder?: ChatTransportErrorDecoder;
    readonly messageEncoder?: ChatMessageEncoder;
    readonly requestBody?: (input: {
      readonly settings: GenericChatSettings;
      readonly conversationId: string | undefined;
      readonly threadId: string | undefined;
      readonly temporary: boolean;
      readonly messages: ReadonlyArray<ChatMessage>;
      readonly text: string;
      readonly files: ReadonlyArray<Attachment>;
    }) => Record<string, unknown>;
  };
  readonly persistence?: ConversationClient;
  readonly storage: {
    readonly settings: KeyValueStorage;
    readonly drafts: KeyValueStorage;
    readonly keys?: {
      readonly settings?: string;
      readonly drafts?: string;
    };
  };
  readonly browser: {
    readonly online: boolean;
    readonly subscribeOnline: (listener: (online: boolean) => void) => () => void;
    readonly subscribeStorage?: (
      listener: (event: { readonly key: string | null; readonly newValue: string | null }) => void,
    ) => () => void;
  };
  readonly webmcp?: {
    readonly modelContext?: WebMcpModelContext;
    readonly toolNames?: ReadonlyArray<WebMcpToolName>;
  };
  readonly identity: {
    readonly createId: () => string;
    readonly now: () => string;
  };
  readonly model?: ModelConfiguration;
  readonly settings?: {
    readonly defaults?: GenericChatSettings;
  };
  readonly extensions?: ReadonlyArray<ChatExtension>;
  readonly features?: {
    readonly attachments?: boolean;
    readonly memories?: boolean;
    readonly branches?: boolean;
    readonly suggestions?: boolean;
    readonly webSearch?: boolean;
  };
  readonly lifecycle?: {
    readonly onSessionCreated?: (input: { readonly conversationId: string }) => void;
    readonly onHistoryChanged?: (input: {
      readonly conversationId: string;
      readonly signal: AbortSignal;
    }) => void | Promise<void>;
    readonly onStreamCompleted?: (input: {
      readonly conversationId: string;
      readonly message: ChatMessage;
      readonly temporary: boolean;
    }) => void | Promise<void>;
  };
  readonly queueSync?: {
    readonly adapter: ChatQueueSyncAdapter;
    readonly onForceSend?: (input: { readonly id: string }) => void;
  };
}

export interface WebMcpState {
  readonly activeConversation: Pick<Conversation, "id" | "title" | "status" | "pinned"> | undefined;
  readonly activeThread: Pick<ThreadViewState, "id" | "conversationId" | "isStreaming">;
  readonly composer: Pick<ComposerState, "text">;
  readonly conversations: {
    readonly items: ReadonlyArray<Pick<Conversation, "id" | "title" | "status" | "pinned">>;
    readonly search: string;
    readonly loading: boolean;
  } & Pick<ConversationListState, "error">;
  readonly memories: {
    readonly items: ReadonlyArray<Pick<Memory, "id" | "content" | "source" | "createdAt">>;
    readonly summary: Pick<MemorySummary, "content" | "memoryCount" | "updatedAt"> | undefined;
    readonly search: string;
    readonly loading: boolean;
  } & Pick<MemoryListState, "error">;
  readonly settings: Pick<ChatSettingsState, "theme">;
  readonly connection: ChatState["connection"];
  readonly temporary: boolean;
  readonly error: string | undefined;
}

export type WebMcpToolName =
  | "get_chat_context"
  | "search_conversations"
  | "open_conversation"
  | "start_new_chat"
  | "set_theme"
  | "search_memories"
  | "fill_message_composer";

export type WebMcpRuntime = {
  readonly getState: () => WebMcpState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly actions: Pick<
    ChatActions,
    | "setConversationSearch"
    | "selectConversation"
    | "startNewConversation"
    | "updateSettings"
    | "setMemoryPanelOpen"
    | "setMemorySearch"
    | "setDraft"
  >;
};

export interface WebMcpRegistrationOptions {
  readonly modelContext?: WebMcpModelContext;
  readonly runtime: WebMcpRuntime;
  readonly features?: ChatRuntimeOptions["features"];
  readonly toolNames?: ReadonlyArray<WebMcpToolName>;
}

export interface WebMcpRegistration {
  start(): void;
  stop(): void;
}

export interface ThreadViewState {
  readonly id: string | undefined;
  readonly conversationId: string | undefined;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly isStreaming: boolean;
  readonly isSending: boolean;
  readonly isSendGraceActive: boolean;
}

export interface ComposerState {
  readonly text: string;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly canSend: boolean;
}

export interface ConversationListState {
  readonly items: ReadonlyArray<Conversation>;
  readonly search: string;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export interface MemoryListState {
  readonly items: ReadonlyArray<Memory>;
  readonly summary: MemorySummary | undefined;
  readonly search: string;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export interface SuggestionsState {
  readonly items: ReadonlyArray<string>;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export interface ChatSettingsState {
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly titleModel: string;
  readonly titlePrompt: string;
  readonly memoryEnabled: boolean;
  readonly memoryModel: string;
  readonly webSearch: boolean;
  readonly theme: "light" | "dark";
}

export interface QueuedFollowUpState {
  readonly id: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

export interface ChatState {
  readonly activeConversation: Conversation | undefined;
  readonly activeThread: ThreadViewState;
  readonly composer: ComposerState;
  readonly conversations: ConversationListState;
  readonly memories: MemoryListState;
  readonly settings: ChatSettingsState;
  readonly connection: "online" | "offline" | "connecting";
  readonly temporary: boolean;
  readonly queuedFollowUps: ReadonlyArray<QueuedFollowUpState>;
  readonly error: string | undefined;
  readonly errorMessageId: string | undefined;
  readonly ui: {
    readonly conversationSearch: string;
    readonly memorySearch: string;
    readonly memoryDraft: string;
    readonly memorySummaryDraft: string | undefined;
    readonly memoryPanelOpen: boolean;
    readonly sidebarOpen: boolean;
    readonly editingQueuedFollowUpId: string | undefined;
  };
  readonly threads: ReadonlyArray<Thread>;
  readonly suggestions: SuggestionsState;
}

export type Selector<Value> = (state: ChatState) => Value;

export interface ChatSelectors {
  readonly activeConversation: Selector<ChatState["activeConversation"]>;
  readonly activeThread: Selector<ThreadViewState>;
  readonly composer: Selector<ComposerState>;
  readonly conversations: Selector<ConversationListState>;
  readonly memories: Selector<MemoryListState>;
  readonly settings: Selector<ChatSettingsState>;
  readonly connection: Selector<ChatState["connection"]>;
  readonly suggestions: Selector<SuggestionsState>;
}

export interface ChatActions {
  sendMessage(input: {
    readonly text: string;
    readonly attachments?: ReadonlyArray<Attachment>;
  }): void;
  /** Resume a paused `needsApproval` tool call with an approve/reject decision. */
  approveToolCall(input: { readonly approvalId: string; readonly approved: boolean }): void;
  stop(): void;
  retry(input: { readonly messageId: string }): void;
  editMessage(input: { readonly messageId: string; readonly text: string }): void;
  selectConversation(input: { readonly conversationId: string }): void;
  selectThread(input: { readonly threadId: string }): void;
  updateConversation(input: {
    readonly conversationId?: string;
    readonly title?: string;
    readonly status?: "regular" | "archived";
    readonly pinned?: boolean;
  }): void;
  deleteConversation(input: {
    readonly conversationId: string;
    readonly resetSession: boolean;
  }): void;
  cloneConversation(input: { readonly conversationId: string }): void;
  compactConversation(input: { readonly conversationId: string }): void;
  updateSettings(input: {
    readonly model?: ModelConfiguration;
    readonly patch?: Partial<ChatSettingsState>;
  }): void;
  setWebSearch(input: { readonly enabled: boolean }): void;
  setDraft(input: { readonly text: string }): void;
  addAttachments(input: { readonly attachments: ReadonlyArray<Attachment> }): void;
  removeAttachment(input: { readonly attachmentId: string }): void;
  startNewConversation(): void;
  createBranch(input: { readonly messageId: string }): void;
  setTemporary(input: { readonly temporary: boolean }): void;
  syncRoute(input: ChatRouteInput): void;
  forceSendQueuedFollowUp(input: { readonly id: string }): void;
  updateQueuedFollowUp(input: {
    readonly id: string;
    readonly text: string;
    readonly attachments: ReadonlyArray<Attachment>;
  }): void;
  replaceQueuedFollowUps(input: { readonly items: ReadonlyArray<QueuedFollowUpState> }): void;
  removeQueuedFollowUp(input: { readonly id: string }): void;
  beginEditingQueuedFollowUp(input: { readonly id: string }): void;
  beginQueuedFollowUpEditWithDraft(input: { readonly id: string }): void;
  commitQueuedFollowUpEdit(input: {
    readonly id: string;
    readonly text: string;
    readonly attachments: ReadonlyArray<Attachment>;
  }): void;
  discardQueuedFollowUpEdit(): void;
  clearQueuedFollowUpEdit(): void;
  setConversationSearch(input: { readonly search: string }): void;
  setMemorySearch(input: { readonly search: string }): void;
  setMemoryDraft(input: { readonly draft: string }): void;
  setMemorySummaryDraft(input: { readonly draft: string }): void;
  setMemoryPanelOpen(input: { readonly open: boolean }): void;
  setSidebarOpen(input: { readonly open: boolean }): void;
  createMemory(): void;
  saveMemorySummary(): void;
  deleteMemory(input: { readonly memoryId: string }): void;
  reportError(input: { readonly error: string }): void;
  clearError(): void;
}

export interface ChatRuntime {
  readonly selectors: ChatSelectors;
  readonly actions: ChatActions;
  readonly getState: () => ChatState;
  start(): void;
  stop(): void;
  dispose(): void;
  subscribe(listener: () => void): () => void;
}
