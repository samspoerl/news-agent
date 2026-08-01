/** Reasoning-effort levels the AI SDK / gateway accepts for a model call. */
export type Reasoning =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** A resolved prompt version: the DB row id plus its instructions body. */
export interface InstructionSet {
  id: number
  body: string
}

/**
 * The parameters and token cost of a single model call, captured for evals and
 * fine-tuning. Persisted as an `AiCall` row (see prisma/schema.prisma).
 * `instructionsId` references the exact `Instructions` version used.
 */
export interface AiCallData {
  model: string
  reasoning: string | null
  instructionsId: number
  inputTokens: number | null
  outputTokens: number | null
}
