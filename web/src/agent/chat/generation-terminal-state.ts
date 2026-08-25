export const resolveGenerationTerminalState = ({
  streamError,
  sawFinish,
}: {
  streamError: string | undefined;
  sawFinish: boolean;
}): { status: "completed" | "failed"; error: string | undefined } => {
  if (streamError !== undefined) return { status: "failed", error: streamError };
  if (sawFinish) return { status: "completed", error: undefined };
  return {
    status: "failed",
    error: "Generation stream ended before a terminal chunk was received.",
  };
};
