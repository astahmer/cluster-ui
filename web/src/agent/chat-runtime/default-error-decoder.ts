import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  GenerationAlreadyRunningError,
  OrphanTurnError,
  parseChatConflictError,
} from "../chat-conflict-errors.ts";
import type { ChatTransportErrorDecoder } from "./transport-types.ts";

const errorBodySchema = Schema.Struct({ error: Schema.String });

export const createDefaultChatErrorDecoder =
  (): ChatTransportErrorDecoder =>
  async ({ response }) => {
    const error = await parseChatConflictError(response);
    if (error instanceof OrphanTurnError) {
      return { message: error.message, messageId: error.orphanMessageId };
    }
    if (error instanceof GenerationAlreadyRunningError) return { message: error.message };
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    const decoded = Schema.decodeUnknownOption(errorBodySchema)(body);
    if (Option.isSome(decoded)) return { message: decoded.value.error };
    return undefined;
  };
