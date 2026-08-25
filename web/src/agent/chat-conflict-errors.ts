import { z } from "zod"

const orphanTurnResponseSchema = z.object({
  code: z.literal("ORPHAN_USER_TURN"),
  orphanMessageId: z.string().uuid(),
})

const generationAlreadyRunningSchema = z.object({
  error: z.literal("A generation is already running"),
  generationId: z.string(),
})

export class OrphanTurnError extends Error {
  readonly orphanMessageId: string

  constructor({ orphanMessageId }: { orphanMessageId: string }) {
    super("Your previous request did not receive a response.")
    this.name = "OrphanTurnError"
    this.orphanMessageId = orphanMessageId
  }
}

export class GenerationAlreadyRunningError extends Error {
  readonly generationId: string

  constructor({ generationId }: { generationId: string }) {
    super("A reply is already in progress elsewhere. Wait for it to finish, or stop it there.")
    this.name = "GenerationAlreadyRunningError"
    this.generationId = generationId
  }
}

export const parseChatConflictError = async (
  response: Response,
): Promise<OrphanTurnError | GenerationAlreadyRunningError | undefined> => {
  if (response.status !== 409) return undefined
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  const orphan = orphanTurnResponseSchema.safeParse(body)
  if (orphan.success) {
    return new OrphanTurnError({ orphanMessageId: orphan.data.orphanMessageId })
  }
  const running = generationAlreadyRunningSchema.safeParse(body)
  if (running.success) {
    return new GenerationAlreadyRunningError({ generationId: running.data.generationId })
  }
  return undefined
}
