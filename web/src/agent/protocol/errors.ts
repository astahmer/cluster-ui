// Vendored from emi-healthfit @emi/core (protocol/errors.ts), adapted to zod.
import { z } from "zod";

const errorCode = z.string().min(1).regex(/^\S+$/);
const errorMessage = z.string().min(1).regex(/\S/);

export const TransportErrorSchema = z.object({
  code: errorCode,
  message: errorMessage,
  retryable: z.boolean(),
  details: z.optional(z.json()),
});
export type TransportError = z.infer<typeof TransportErrorSchema>;

export const ErrorResponseDtoSchema = z.object({
  error: TransportErrorSchema,
});
export type ErrorResponseDto = z.infer<typeof ErrorResponseDtoSchema>;

export class ProtocolDecodeError extends Error {
  readonly _tag = "ProtocolDecodeError";

  constructor(message: string) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
}
