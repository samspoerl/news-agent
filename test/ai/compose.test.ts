import type { InstructionSet } from '@/ai/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `ai` is mocked wholesale: these tests are about how composeBrief reads a
// response, not about the model. generateText is queued with canned results.
const generateText = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({ generateText }))

const PRIMARY = 'test/primary'
const FALLBACK = 'test/fallback'

const INSTRUCTIONS: InstructionSet = { id: 7, body: 'write the brief' }

// The module reads its model names from the environment at import time, so each
// test imports it fresh with the env it wants.
async function loadComposeBrief(env: Record<string, string> = {}) {
  vi.resetModules()
  process.env.COMPOSE_MODEL = env.COMPOSE_MODEL ?? PRIMARY
  process.env.COMPOSE_FALLBACK_MODEL = env.COMPOSE_FALLBACK_MODEL ?? FALLBACK
  process.env.COMPOSE_REASONING = env.COMPOSE_REASONING ?? 'low'
  return (await import('@/ai/compose')).composeBrief
}

// The shape generateText resolves to, for the parts composeBrief actually reads.
function response(text: string, finishReason = 'stop') {
  return {
    text,
    finishReason,
    usage: { inputTokens: 100, outputTokens: 200 },
  }
}

const CORPUS = '# News\n\n[Story](https://example.com/a)\n'
const BRIEF = '## Need to Know\n\n**Something happened.**\n[1]({{LINK0}})'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'log').mockImplementation((msg) => void logged.push(msg))
})

afterEach(() => {
  vi.restoreAllMocks()
  generateText.mockReset()
  delete process.env.COMPOSE_MODEL
  delete process.env.COMPOSE_FALLBACK_MODEL
  delete process.env.COMPOSE_REASONING
})

describe('composeBrief', () => {
  it('returns the restored brief and the model that produced it', async () => {
    const composeBrief = await loadComposeBrief()
    generateText.mockResolvedValueOnce(response(BRIEF))

    const result = await composeBrief(CORPUS, INSTRUCTIONS)

    expect(result.body).toContain('[1](https://example.com/a)')
    expect(result.droppedLinks).toEqual([])
    expect(result.aiCall).toEqual({
      model: PRIMARY,
      reasoning: 'low',
      instructionsId: 7,
      inputTokens: 100,
      outputTokens: 200,
    })
    expect(generateText).toHaveBeenCalledOnce()
  })

  // The bug this guards: a content-filtered response resolves cleanly with no
  // text, which read as a brief with nothing in it and went out as one.
  it('retries on the fallback model when the primary is content-filtered', async () => {
    const composeBrief = await loadComposeBrief()
    generateText
      .mockResolvedValueOnce(response('', 'content-filter'))
      .mockResolvedValueOnce(response(BRIEF))

    const result = await composeBrief(CORPUS, INSTRUCTIONS)

    expect(result.body).toContain('Something happened')
    expect(result.aiCall.model).toBe(FALLBACK)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(logged.join('\n')).toContain('content-filter')
  })

  it('retries when the primary stops early with a truncated brief', async () => {
    const composeBrief = await loadComposeBrief()
    generateText
      .mockResolvedValueOnce(
        response('## Need to Know\n\n**Half a sto', 'length')
      )
      .mockResolvedValueOnce(response(BRIEF))

    const result = await composeBrief(CORPUS, INSTRUCTIONS)

    expect(result.aiCall.model).toBe(FALLBACK)
  })

  it('retries when the model stops cleanly but returns nothing', async () => {
    const composeBrief = await loadComposeBrief()
    generateText
      .mockResolvedValueOnce(response('   \n  '))
      .mockResolvedValueOnce(response(BRIEF))

    const result = await composeBrief(CORPUS, INSTRUCTIONS)

    expect(result.aiCall.model).toBe(FALLBACK)
  })

  it('throws rather than returning an empty brief when every model fails', async () => {
    const composeBrief = await loadComposeBrief()
    generateText
      .mockResolvedValueOnce(response('', 'content-filter'))
      .mockResolvedValueOnce(response('', 'content-filter'))

    await expect(composeBrief(CORPUS, INSTRUCTIONS)).rejects.toThrow(
      /no usable brief/
    )
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('makes a single attempt when both models are the same', async () => {
    const composeBrief = await loadComposeBrief({
      COMPOSE_FALLBACK_MODEL: PRIMARY,
    })
    generateText.mockResolvedValueOnce(response('', 'content-filter'))

    await expect(composeBrief(CORPUS, INSTRUCTIONS)).rejects.toThrow(
      /no usable brief/
    )
    expect(generateText).toHaveBeenCalledOnce()
  })

  // daily-brief.yml passes optional overrides as `${{ vars.* }}`, which expands
  // to an empty string when the repo variable is unset.
  it('falls back to the code defaults when the env vars are empty', async () => {
    const composeBrief = await loadComposeBrief({
      COMPOSE_MODEL: '',
      COMPOSE_FALLBACK_MODEL: '',
      COMPOSE_REASONING: '',
    })
    generateText.mockResolvedValueOnce(response(BRIEF))

    const result = await composeBrief(CORPUS, INSTRUCTIONS)

    expect(result.aiCall.model).toBe('anthropic/claude-sonnet-5')
    expect(result.aiCall.reasoning).toBe('high')
  })
})
