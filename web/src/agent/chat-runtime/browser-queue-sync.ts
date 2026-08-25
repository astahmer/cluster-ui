import { z } from "zod";

import { AttachmentSchema } from "../protocol/parts.ts";
import type {
  ChatQueueSyncAdapter,
  ChatQueueSyncMessage,
  ChatQueueSyncPayload,
  QueuedFollowUpState,
} from "../runtime/types.ts";

export const FOLLOW_UP_QUEUE_STORAGE_PREFIX = "emi-chat:follow-up-queue:";
export const FOLLOW_UP_QUEUE_CHANNEL = "emi-chat-follow-up-queue";
export const FOLLOW_UP_QUEUE_STORAGE_MAX_CHARS = 1_500_000;

const StoredQueuedFollowUpSchema = z.object({
  id: z.string(),
  text: z.string(),
  attachments: z.array(AttachmentSchema),
});

const QueueSyncPayloadSchema = z.object({
  type: z.literal("queue.sync"),
  sessionId: z.string(),
  tabId: z.string(),
  revision: z.number(),
  items: z.array(StoredQueuedFollowUpSchema),
});

const QueueForceSendPayloadSchema = z.object({
  type: z.literal("queue.force-send"),
  sessionId: z.string(),
  tabId: z.string(),
  itemId: z.string(),
});

const QueueForceSendClaimPayloadSchema = z.object({
  type: z.literal("queue.force-send-claim"),
  sessionId: z.string(),
  tabId: z.string(),
  itemId: z.string(),
});

const QueueChannelMessageSchema = z.union([
  QueueSyncPayloadSchema,
  QueueForceSendPayloadSchema,
  QueueForceSendClaimPayloadSchema,
]);

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const decodeOrNull = <Value>(schema: z.ZodType<Value>, raw: unknown): Value | null => {
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
};

export interface BrowserStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export interface BrowserQueueChannelLike {
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly postMessage: (message: unknown) => void;
  readonly close: () => void;
}

export interface BrowserFollowUpQueueSyncOptions {
  readonly storage: BrowserStorageLike;
  readonly createId: () => string;
  readonly createChannel?: (name: string) => BrowserQueueChannelLike;
  readonly subscribeStorage?: (
    listener: (event: { readonly key: string | null; readonly newValue: string | null }) => void,
  ) => () => void;
}

export const followUpQueueStorageKey = (sessionId: string): string =>
  `${FOLLOW_UP_QUEUE_STORAGE_PREFIX}${sessionId}`;

export const stripHeavyQueueAttachments = (
  items: ReadonlyArray<QueuedFollowUpState>,
): QueuedFollowUpState[] =>
  items.map((item) => ({
    ...item,
    attachments: item.attachments.filter((attachment) => attachment.url.length <= 8_000),
  }));

export const serializeFollowUpQueue = (payload: ChatQueueSyncPayload): string => {
  const full = JSON.stringify(payload);
  if (full.length <= FOLLOW_UP_QUEUE_STORAGE_MAX_CHARS) return full;
  return JSON.stringify({ ...payload, items: stripHeavyQueueAttachments(payload.items) });
};

export const parseFollowUpQueueSync = (raw: unknown): ChatQueueSyncPayload | null =>
  decodeOrNull(QueueSyncPayloadSchema, raw);

export const parseFollowUpQueueChannelMessage = (raw: unknown): ChatQueueSyncMessage | null =>
  decodeOrNull(QueueChannelMessageSchema, raw);

export const parseFollowUpQueueSyncJson = (raw: string): ChatQueueSyncPayload | null =>
  decodeOrNull(QueueSyncPayloadSchema, parseJson(raw));

export const readStoredFollowUpQueue = ({
  sessionId,
  storage,
}: {
  readonly sessionId: string;
  readonly storage: Pick<BrowserStorageLike, "getItem">;
}): ChatQueueSyncPayload | null => {
  try {
    const raw = storage.getItem(followUpQueueStorageKey(sessionId));
    return raw === null ? null : parseFollowUpQueueSyncJson(raw);
  } catch {
    return null;
  }
};

export const writeStoredFollowUpQueue = ({
  payload,
  storage,
}: {
  readonly payload: ChatQueueSyncPayload;
  readonly storage: Pick<BrowserStorageLike, "setItem" | "removeItem">;
}): void => {
  const key = followUpQueueStorageKey(payload.sessionId);
  try {
    if (payload.items.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, serializeFollowUpQueue(payload));
  } catch {
    try {
      storage.setItem(
        key,
        serializeFollowUpQueue({ ...payload, items: stripHeavyQueueAttachments(payload.items) }),
      );
    } catch {
      return;
    }
  }
};

export const createBrowserFollowUpQueueSyncAdapter = ({
  storage,
  createId,
  createChannel,
  subscribeStorage,
}: BrowserFollowUpQueueSyncOptions): ChatQueueSyncAdapter => {
  const tabId = createId();
  return {
    tabId,
    read: (sessionId) => readStoredFollowUpQueue({ sessionId, storage }),
    write: (payload) => writeStoredFollowUpQueue({ payload, storage }),
    subscribe: (sessionId, listener) => {
      const channel = createChannel?.(FOLLOW_UP_QUEUE_CHANNEL);
      const onChannelMessage = (event: { readonly data: unknown }) => {
        const message = parseFollowUpQueueChannelMessage(event.data);
        if (message !== null) listener(message);
      };
      channel?.addEventListener("message", onChannelMessage);
      const unsubscribeStorage =
        subscribeStorage?.((event) => {
          if (event.key !== followUpQueueStorageKey(sessionId)) return;
          if (event.newValue === null) {
            listener({
              type: "queue.sync",
              sessionId,
              tabId: "storage:cleared",
              revision: Number.MAX_SAFE_INTEGER,
              items: [],
            });
            return;
          }
          const payload = parseFollowUpQueueSyncJson(event.newValue);
          if (payload !== null) listener(payload);
        }) ?? (() => undefined);
      return () => {
        unsubscribeStorage();
        channel?.removeEventListener("message", onChannelMessage);
        channel?.close();
      };
    },
    broadcast: (message) => {
      const channel = createChannel?.(FOLLOW_UP_QUEUE_CHANNEL);
      if (channel === undefined) return;
      try {
        channel.postMessage(message);
      } finally {
        channel.close();
      }
    },
  };
};

export interface WindowFollowUpQueueSyncOptions {
  readonly target: {
    readonly localStorage: BrowserStorageLike;
    readonly addEventListener: (
      type: "storage",
      listener: (event: { readonly key: string | null; readonly newValue: string | null }) => void,
    ) => void;
    readonly removeEventListener: (
      type: "storage",
      listener: (event: { readonly key: string | null; readonly newValue: string | null }) => void,
    ) => void;
  };
  readonly BroadcastChannel?: {
    new (name: string): BrowserQueueChannelLike;
  };
  readonly createTabId: () => string;
}

export const createWindowFollowUpQueueSyncAdapter = ({
  target,
  BroadcastChannel,
  createTabId,
}: WindowFollowUpQueueSyncOptions): ChatQueueSyncAdapter =>
  createBrowserFollowUpQueueSyncAdapter({
    storage: target.localStorage,
    createId: createTabId,
    createChannel:
      BroadcastChannel === undefined ? undefined : (name) => new BroadcastChannel(name),
    subscribeStorage: (listener) => {
      const onStorage = (event: {
        readonly key: string | null;
        readonly newValue: string | null;
      }) => listener(event);
      target.addEventListener("storage", onStorage);
      return () => target.removeEventListener("storage", onStorage);
    },
  });
