const unreadableMarkers = new Set(["[object Object]", "{}", "[object Undefined]", "[object Null]"]);

const readableString = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (trimmed === "" || unreadableMarkers.has(trimmed)) return fallback;
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
};

const asRecord = (cause: object): Record<string, unknown> => cause as Record<string, unknown>;

export const readableErrorMessage = (cause: unknown, fallback: string): string => {
  if (cause instanceof Error) return readableString(cause.message, fallback);
  if (typeof cause === "string") return readableString(cause, fallback);
  if (cause !== null && typeof cause === "object") {
    const record = asRecord(cause);
    const candidate = record.message ?? record.error;
    if (typeof candidate === "string") return readableString(candidate, fallback);
    if (candidate !== null && typeof candidate === "object") {
      const nested = asRecord(candidate).message;
      if (typeof nested === "string") return readableString(nested, fallback);
    }
    if (typeof record.statusText === "string" && record.statusText.trim() !== "") {
      const status = record.status;
      return readableString(
        typeof status === "number" ? `${status} ${record.statusText}` : record.statusText,
        fallback,
      );
    }
    try {
      const serialized = JSON.stringify(cause);
      if (serialized !== undefined) return readableString(serialized, fallback);
    } catch {
      return fallback;
    }
  }
  return fallback;
};
