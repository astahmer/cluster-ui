import { assign, setup } from "xstate";

export interface ChatUiContext {
  conversationSearch: string;
  memorySearch: string;
  memoryDraft: string;
  memorySummaryDraft: string | undefined;
  memorySummaryDirty: boolean;
  memoryPanelOpen: boolean;
  sidebarOpen: boolean;
  editingQueuedFollowUpId: string | undefined;
}

export type ChatUiActorEvent =
  | { type: "conversation-search-changed"; search: string }
  | { type: "memory-search-changed"; search: string }
  | { type: "memory-draft-changed"; draft: string }
  | { type: "memory-draft-cleared" }
  | { type: "memory-summary-draft-changed"; draft: string }
  | { type: "memory-summary-loaded"; content: string | undefined }
  | { type: "memory-summary-saved"; content: string }
  | { type: "memory-panel-changed"; open: boolean }
  | { type: "sidebar-open-changed"; open: boolean }
  | { type: "queued-follow-up-edit-started"; id: string }
  | { type: "queued-follow-up-edit-cleared" };

export const chatUiActor = setup({
  types: {
    context: {} as ChatUiContext,
    events: {} as ChatUiActorEvent,
  },
  actions: {
    changeConversationSearch: assign(({ event }) =>
      event.type === "conversation-search-changed" ? { conversationSearch: event.search } : {},
    ),
    changeMemorySearch: assign(({ event }) =>
      event.type === "memory-search-changed" ? { memorySearch: event.search } : {},
    ),
    changeMemoryDraft: assign(({ event }) =>
      event.type === "memory-draft-changed" ? { memoryDraft: event.draft } : {},
    ),
    clearMemoryDraft: assign(({ event }) =>
      event.type === "memory-draft-cleared" ? { memoryDraft: "" } : {},
    ),
    changeMemorySummaryDraft: assign(({ event }) =>
      event.type === "memory-summary-draft-changed"
        ? { memorySummaryDraft: event.draft, memorySummaryDirty: true }
        : {},
    ),
    loadMemorySummary: assign(({ context, event }) =>
      event.type === "memory-summary-loaded" && !context.memorySummaryDirty
        ? { memorySummaryDraft: event.content }
        : {},
    ),
    saveMemorySummary: assign(({ event }) =>
      event.type === "memory-summary-saved"
        ? { memorySummaryDraft: event.content, memorySummaryDirty: false }
        : {},
    ),
    changeMemoryPanel: assign(({ event }) =>
      event.type === "memory-panel-changed" ? { memoryPanelOpen: event.open } : {},
    ),
    changeSidebar: assign(({ event }) =>
      event.type === "sidebar-open-changed" ? { sidebarOpen: event.open } : {},
    ),
    startQueuedFollowUpEdit: assign(({ event }) =>
      event.type === "queued-follow-up-edit-started" ? { editingQueuedFollowUpId: event.id } : {},
    ),
    clearQueuedFollowUpEdit: assign(({ event }) =>
      event.type === "queued-follow-up-edit-cleared" ? { editingQueuedFollowUpId: undefined } : {},
    ),
  },
}).createMachine({
  id: "chatUi",
  initial: "ready",
  context: {
    conversationSearch: "",
    memorySearch: "",
    memoryDraft: "",
    memorySummaryDraft: undefined,
    memorySummaryDirty: false,
    memoryPanelOpen: false,
    sidebarOpen: true,
    editingQueuedFollowUpId: undefined,
  },
  states: {
    ready: {
      on: {
        "conversation-search-changed": { actions: "changeConversationSearch" },
        "memory-search-changed": { actions: "changeMemorySearch" },
        "memory-draft-changed": { actions: "changeMemoryDraft" },
        "memory-draft-cleared": { actions: "clearMemoryDraft" },
        "memory-summary-draft-changed": { actions: "changeMemorySummaryDraft" },
        "memory-summary-loaded": { actions: "loadMemorySummary" },
        "memory-summary-saved": { actions: "saveMemorySummary" },
        "memory-panel-changed": { actions: "changeMemoryPanel" },
        "sidebar-open-changed": { actions: "changeSidebar" },
        "queued-follow-up-edit-started": { actions: "startQueuedFollowUpEdit" },
        "queued-follow-up-edit-cleared": { actions: "clearQueuedFollowUpEdit" },
      },
    },
  },
});
