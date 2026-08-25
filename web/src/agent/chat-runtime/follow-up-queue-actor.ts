import { fromCallback, sendTo, setup } from "xstate";

import type {
  ChatQueueSyncAdapter,
  ChatQueueSyncMessage,
  ChatRouteInput,
  QueuedFollowUpState,
} from "../runtime/types.ts";
import type { ChatSessionEvent, QueuedFollowUp } from "../chat-session-machine.ts";

export interface FollowUpQueueActorInput {
  readonly adapter: ChatQueueSyncAdapter | undefined;
  readonly sendSession: (event: ChatSessionEvent) => void;
  readonly onForceSend?: (input: { readonly id: string }) => void;
}

export type FollowUpQueueActorEvent =
  | { type: "route-sync-requested"; route: ChatRouteInput }
  | { type: "force-send-requested"; id: string }
  | { type: "session-event"; event: ChatSessionEvent };

const toQueueState = (items: QueuedFollowUp[]): QueuedFollowUpState[] =>
  items.map((item) => ({
    id: item.id,
    text: item.text,
    attachments: [...item.files],
  }));

const toSessionItems = (items: ReadonlyArray<QueuedFollowUpState>): QueuedFollowUp[] =>
  items.map((item) => ({
    id: item.id,
    text: item.text,
    files: [...item.attachments],
  }));

const queuesEqual = (
  left: ReadonlyArray<QueuedFollowUpState>,
  right: ReadonlyArray<QueuedFollowUpState>,
): boolean => {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    if (other === undefined || item.id !== other.id || item.text !== other.text) return false;
    if (item.attachments.length !== other.attachments.length) return false;
    return item.attachments.every((attachment, attachmentIndex) => {
      const otherAttachment = other.attachments[attachmentIndex];
      return (
        otherAttachment !== undefined &&
        attachment.url === otherAttachment.url &&
        attachment.mediaType === otherAttachment.mediaType &&
        attachment.name === otherAttachment.name
      );
    });
  });
};

const followUpQueueOperations = fromCallback<FollowUpQueueActorEvent, FollowUpQueueActorInput>(
  ({ input, receive }) => {
    let route: ChatRouteInput = {
      historyReady: false,
      sessionId: undefined,
      threadId: undefined,
      temporary: false,
    };
    let queue: QueuedFollowUpState[] = [];
    let revision = 0;
    let hydrated = false;
    let unsubscribe: (() => void) | undefined;
    let isStreaming = false;
    let appliedRouteKey: string | undefined;
    let pendingLocalForceSend: { id: string; timer: ReturnType<typeof setTimeout> } | undefined;

    const cancelPendingLocalForceSend = (): void => {
      if (pendingLocalForceSend === undefined) return;
      clearTimeout(pendingLocalForceSend.timer);
      pendingLocalForceSend = undefined;
    };

    const activeSessionId = () =>
      route.historyReady && !route.temporary ? route.sessionId : undefined;

    const clearSubscription = () => {
      unsubscribe?.();
      unsubscribe = undefined;
    };

    const writeQueue = () => {
      const sessionId = activeSessionId();
      const adapter = input.adapter;
      if (!hydrated || sessionId === undefined || adapter === undefined) return;
      revision += 1;
      const payload = {
        type: "queue.sync" as const,
        sessionId,
        tabId: adapter.tabId,
        revision,
        items: queue,
      };
      adapter.write(payload);
      adapter.broadcast(payload);
    };

    const restoreStoredQueue = () => {
      const sessionId = activeSessionId();
      const adapter = input.adapter;
      if (!hydrated || sessionId === undefined || adapter === undefined) return;
      const stored = adapter.read(sessionId);
      if (stored === null || stored.revision < revision) return;
      revision = stored.revision;
      queue = stored.items.map((item) => ({
        id: item.id,
        text: item.text,
        attachments: [...item.attachments],
      }));
      input.sendSession({
        type: "queued-follow-ups-replaced",
        items: toSessionItems(queue),
      });
    };

    const applyRemoteMessage = (message: ChatQueueSyncMessage) => {
      const sessionId = activeSessionId();
      const adapter = input.adapter;
      if (sessionId === undefined || adapter === undefined || message.tabId === adapter.tabId)
        return;
      if (message.sessionId !== sessionId) return;
      if (message.type === "queue.force-send-claim") {
        if (
          pendingLocalForceSend !== undefined &&
          pendingLocalForceSend.id === message.itemId &&
          message.tabId !== adapter?.tabId
        ) {
          cancelPendingLocalForceSend();
        }
        return;
      }
      if (message.type === "queue.force-send") {
        if (isStreaming) {
          input.onForceSend?.({ id: message.itemId });
          adapter.broadcast({
            type: "queue.force-send-claim",
            sessionId: message.sessionId,
            tabId: adapter.tabId,
            itemId: message.itemId,
          });
        }
        return;
      }
      if (message.revision < revision) return;
      revision = message.revision;
      if (queuesEqual(queue, message.items)) return;
      queue = message.items.map((item) => ({
        id: item.id,
        text: item.text,
        attachments: [...item.attachments],
      }));
      input.sendSession({
        type: "queued-follow-ups-replaced",
        items: toSessionItems(queue),
      });
    };

    const handleForceSendRequest = ({ id }: { readonly id: string }) => {
      const sessionId = activeSessionId();
      const adapter = input.adapter;
      if (sessionId === undefined || adapter === undefined) return;
      if (isStreaming) {
        input.onForceSend?.({ id });
        return;
      }
      adapter.broadcast({
        type: "queue.force-send",
        sessionId,
        tabId: adapter.tabId,
        itemId: id,
      });
      cancelPendingLocalForceSend();
      pendingLocalForceSend = {
        id,
        timer: setTimeout(() => {
          const fallbackId = pendingLocalForceSend?.id;
          pendingLocalForceSend = undefined;
          if (fallbackId === undefined || isStreaming) return;
          input.onForceSend?.({ id: fallbackId });
        }, 250),
      };
    };

    const hydrate = () => {
      clearSubscription();
      cancelPendingLocalForceSend();
      queue = [];
      revision = 0;
      hydrated = false;
      isStreaming = false;
      const sessionId = activeSessionId();
      const adapter = input.adapter;
      if (sessionId === undefined || adapter === undefined) {
        hydrated = true;
        return;
      }
      const stored = adapter.read(sessionId);
      if (stored !== null) {
        revision = stored.revision;
        queue = stored.items.map((item) => ({
          id: item.id,
          text: item.text,
          attachments: [...item.attachments],
        }));
        input.sendSession({
          type: "queued-follow-ups-replaced",
          items: toSessionItems(queue),
        });
      }
      hydrated = true;
      unsubscribe = adapter.subscribe(sessionId, applyRemoteMessage);
    };

    const handleSessionEvent = (event: ChatSessionEvent) => {
      if (event.type === "conversation-opened" || event.type === "thread-opened") {
        restoreStoredQueue();
        return;
      }
      if (event.type === "stream-started" || event.type === "stream-resumed") {
        isStreaming = true;
        return;
      }
      if (event.type === "stream-finished") {
        isStreaming = false;
        return;
      }
      if (event.type === "follow-up-queued") {
        queue = [...queue, ...toQueueState([event.followUp])];
        writeQueue();
        return;
      }
      if (event.type === "queued-follow-up-forced") {
        queue = queue.filter((item) => item.id !== event.id);
        writeQueue();
        return;
      }
      if (event.type === "queued-follow-up-updated") {
        queue = queue.map((item) =>
          item.id === event.id
            ? { ...item, text: event.text, attachments: [...event.files] }
            : item,
        );
        writeQueue();
        return;
      }
      if (event.type === "queued-follow-up-removed") {
        queue = queue.filter((item) => item.id !== event.id);
        writeQueue();
        return;
      }
      if (event.type === "queued-follow-ups-replaced") {
        queue = toQueueState(event.items);
        writeQueue();
      }
    };

    receive((event) => {
      if (event.type === "route-sync-requested") {
        const nextRouteKey = `${event.route.historyReady ? "ready" : "waiting"}:${event.route.sessionId ?? "new"}:${event.route.temporary ? "temporary" : "persistent"}`;
        if (nextRouteKey === appliedRouteKey) return;
        appliedRouteKey = nextRouteKey;
        route = event.route;
        hydrate();
        return;
      }
      if (event.type === "force-send-requested") {
        handleForceSendRequest(event);
        return;
      }
      if (event.type === "session-event") handleSessionEvent(event.event);
    });

    return () => {
      cancelPendingLocalForceSend();
      clearSubscription();
    };
  },
);

export const followUpQueueActor = setup({
  types: {
    context: {} as FollowUpQueueActorInput,
    input: {} as FollowUpQueueActorInput,
    events: {} as FollowUpQueueActorEvent,
  },
  actors: { operations: followUpQueueOperations },
  actions: {
    forwardEvent: sendTo("operations", ({ event }) => event),
  },
}).createMachine({
  id: "followUpQueue",
  context: ({ input }) => input,
  invoke: { id: "operations", src: "operations", input: ({ context }) => context },
  on: {
    "route-sync-requested": { actions: "forwardEvent" },
    "force-send-requested": { actions: "forwardEvent" },
    "session-event": { actions: "forwardEvent" },
  },
});
