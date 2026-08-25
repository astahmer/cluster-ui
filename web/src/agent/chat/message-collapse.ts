export const collapseCompactedMessages = <
  Message extends { role: string; createdAt: string; parentId?: string | null },
>(
  messages: ReadonlyArray<Message>,
): Message[] => {
  const markerIndex = messages.findLastIndex((message) => message.role === "summary");
  if (markerIndex === -1) return [...messages];
  const marker = messages[markerIndex];
  if (marker === undefined) return [...messages];
  return [
    marker,
    ...messages
      .filter(
        (message) =>
          message !== marker &&
          message.role !== "summary" &&
          (message.parentId === null || message.parentId === undefined
            ? messages.indexOf(message) > markerIndex
            : true),
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
  ];
};
