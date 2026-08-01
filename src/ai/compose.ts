import type { AiCallData, InstructionSet, Reasoning } from '@/ai/types'
import { restoreLinks, stripLinks, tokenizeLinkUrls } from '@/brief/links'
import { generateText } from 'ai'

// The composer does the whole judgment pass — triage, cluster, dedup, write — in
// one call, so it gets a strong reasoning model. Overridable for evals. The
// instructions are injected (resolved from the DB by the caller), not hard-coded.
//
// `||` rather than `??`: daily-brief.yml passes these through as `${{ vars.* }}`,
// which expands to an empty string when the repo variable is unset. `??` would
// take that empty string as an override and send a request naming no model at all.
const COMPOSE_MODEL = process.env.COMPOSE_MODEL || 'anthropic/claude-sonnet-5'
const COMPOSE_REASONING = (process.env.COMPOSE_REASONING || 'high') as Reasoning

// A second model, on a different provider, retried when the primary returns no
// usable brief. Provider safety filters are why this exists: a single ordinary
// news item — a malware write-up, an exploit, a prompt-injection worm — can trip
// one provider's classifier and take the whole day's brief down with it, while
// another provider composes the same corpus without complaint. Set it equal to
// COMPOSE_MODEL to run a single attempt and no retry.
const COMPOSE_FALLBACK_MODEL =
  process.env.COMPOSE_FALLBACK_MODEL || 'openai/gpt-5.6-luna'

export interface ComposedBrief {
  body: string
  aiCall: AiCallData
  droppedLinks: string[] // URLs in the brief that aren't in the corpus.
}

/**
 * Why an attempt's response isn't a brief worth sending, or null if it is.
 *
 * A refused or truncated generation is not an error the AI SDK throws on — it
 * resolves normally, and only `finishReason` says what happened. `content-filter`
 * in particular comes back as a clean response carrying no text whatsoever, which
 * is indistinguishable from a quiet news day unless it is checked for. Anything
 * other than a clean `stop` means the response is not a whole brief (`length`
 * leaves one cut off mid-story), so none of them are worth mailing.
 */
function attemptProblem(finishReason: string, body: string): string | null {
  if (finishReason !== 'stop') return `finishReason: ${finishReason}`
  if (!body.trim()) return 'the model returned no text'
  return null
}

/**
 * Compose the finished Markdown brief from the corpus in a single pass. Recent
 * brief bodies (most recent first) are passed as dedup context; `instructions` is
 * the resolved prompt version to use.
 *
 * The corpus is tokenized before the model sees it — every URL becomes a short
 * `{{LINKn}}` token, restored to its exact value afterward. Corpus URLs are long and
 * numerous (tracking links run into the hundreds of characters, and they can be
 * roughly half the corpus by size), so this cuts the input cost sharply, and the
 * composer can no longer lose a link by mistranscribing it — copying `{{LINK17}}` is
 * the whole job. Recent briefs are stripped of links entirely: dedup needs the prose,
 * and a URL only yesterday's corpus carried has no business in today's brief.
 *
 * Returns the finished Markdown — restored, and guarded against any link the model
 * produced that isn't in the corpus — plus the call's eval metadata, naming the
 * model that actually produced it.
 *
 * Throws if no model returns a usable brief. That is deliberately fatal: an empty
 * compose is not "no news today", and the run writes nothing until after a
 * successful send, so failing here leaves the newsletters unarchived in the inbox
 * for a retry or a `--date` rebuild rather than burning them on a blank brief.
 */
export async function composeBrief(
  corpus: string,
  instructions: InstructionSet,
  recentBriefs: string[] = []
): Promise<ComposedBrief> {
  const { text: tokenized, urls } = tokenizeLinkUrls(corpus)

  const prompt = [
    "Here is today's news corpus. Write the awareness brief.",
    '',
    '<corpus>',
    tokenized,
    '</corpus>',
  ]
  if (recentBriefs.length) {
    prompt.push(
      '',
      '<recent_briefs>',
      recentBriefs
        .map(
          (b, i) =>
            `--- Brief ${i + 1} (most recent first) ---\n${stripLinks(b)}`
        )
        .join('\n\n'),
      '</recent_briefs>'
    )
  }

  // Deduped, so pointing both env vars at one model means one attempt, not two.
  const models = [...new Set([COMPOSE_MODEL, COMPOSE_FALLBACK_MODEL])]
  const problems: string[] = []

  for (const model of models) {
    const { text, usage, finishReason } = await generateText({
      model,
      reasoning: COMPOSE_REASONING,
      instructions: instructions.body,
      prompt: prompt.join('\n'),
    })

    const { text: body, removed } = restoreLinks(text.trim(), urls)

    const problem = attemptProblem(finishReason, body)
    if (problem) {
      problems.push(`${model} — ${problem}`)
      console.log(`  ! no usable brief from ${model} (${problem})`)
      continue
    }

    return {
      body,
      droppedLinks: removed,
      aiCall: {
        model,
        reasoning: COMPOSE_REASONING,
        instructionsId: instructions.id,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
      },
    }
  }

  throw new Error(
    `The composer returned no usable brief (${problems.join('; ')}). ` +
      `Nothing was sent, and today's newsletters are still in the inbox.`
  )
}
