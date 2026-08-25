export interface QueueEditNavigationState {
  readonly editingQueuedId: string | null;
}

export const resolveQueueEditTarget = ({
  queuedFollowUps,
  editingQueuedId,
  direction,
}: {
  queuedFollowUps: ReadonlyArray<{ readonly id: string }>;
  editingQueuedId: string | null;
  direction: "up" | "down";
}): { readonly id: string } | null => {
  if (queuedFollowUps.length === 0) return null;
  const currentIndex =
    editingQueuedId === null
      ? -1
      : queuedFollowUps.findIndex((item) => item.id === editingQueuedId);

  if (direction === "up") {
    if (currentIndex < 0) return queuedFollowUps.at(-1) ?? null;
    if (currentIndex === 0) return queuedFollowUps[0] ?? null;
    return queuedFollowUps[currentIndex - 1] ?? null;
  }

  if (currentIndex < 0) return null;
  if (currentIndex >= queuedFollowUps.length - 1) return null;
  return queuedFollowUps[currentIndex + 1] ?? null;
};

export const shouldHandleQueueArrowKey = ({
  key,
  draft,
  selectionStart,
  queueLength,
  editingQueuedId,
}: {
  key: string;
  draft: string;
  selectionStart: number | null;
  queueLength: number;
  editingQueuedId: string | null;
}): boolean => {
  if (queueLength === 0) return false;
  if (key === "ArrowUp") {
    return editingQueuedId !== null || (draft === "" && selectionStart === 0);
  }
  if (key === "ArrowDown") {
    return editingQueuedId !== null;
  }
  return false;
};
