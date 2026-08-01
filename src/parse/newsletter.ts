import type { AiCallData, InstructionSet, Reasoning } from '@/ai/types'
import { restoreLinks, tokenizeLinkUrls } from '@/brief/links'
import { generateText } from 'ai'
import TurndownService from 'turndown'

// A cheap, fast model at low effort: the cleanup task is mechanical (tidy rough
// Markdown), not reasoning-heavy. Overridable for evals. The cleanup prompt is
// injected (resolved from the DB by the caller), not hard-coded.
const CLEANUP_MODEL =
  process.env.NEWSLETTER_CLEANUP_MODEL ?? 'openai/gpt-5.6-luna'
const CLEANUP_REASONING = (process.env.NEWSLETTER_CLEANUP_REASONING ??
  'low') as Reasoning

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
// Elements Turndown would otherwise dump as raw text content.
turndown.remove([
  'style',
  'script',
  'head',
  'noscript',
  'title',
  'link',
  'meta',
])

// Cheap pre-pass before Turndown: drop the biggest noise (comments, style/script
// blocks, <head>) so we don't pay the model to read CSS and tracking markup.
function preStrip(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
}

/** Deterministic HTML → rough Markdown (no model). Exported for unit tests. */
export function htmlToRoughMarkdown(html: string): string {
  const rough = turndown.turndown(preStrip(html))
  return rough.replace(/\n{3,}/g, '\n\n').trim()
}

export interface ParsedNewsletter {
  markdown: string
  aiCall: AiCallData | null // null when the model step was skipped or fell back.
  droppedLinks: string[] // URLs the cleanup produced that aren't in the raw HTML.
}

/**
 * Parse one newsletter's raw HTML into clean corpus Markdown: strip → Turndown →
 * (tokenize URLs) → model cleanup → restore URLs. URLs are swapped for short
 * `{{LINKn}}` tokens before the model sees them and restored to the exact
 * Turndown-extracted values afterward, so the model can clean the prose but can
 * never corrupt a URL. Degrades gracefully — if the model call fails, the Turndown
 * output alone is used (aiCall null), so one flaky newsletter never sinks the run.
 * A final guard drops any link whose URL isn't one of the originals (a leftover or
 * mangled token, or anything the model somehow introduced), keeping its label.
 */
export async function parseNewsletter(
  html: string,
  instructions: InstructionSet
): Promise<ParsedNewsletter> {
  const rough = htmlToRoughMarkdown(html)
  if (!rough) return { markdown: '', aiCall: null, droppedLinks: [] }

  const { text: tokenized, urls } = tokenizeLinkUrls(rough)

  let cleaned = tokenized
  let aiCall: AiCallData | null = null
  try {
    const { text, usage } = await generateText({
      model: CLEANUP_MODEL,
      reasoning: CLEANUP_REASONING,
      instructions: instructions.body,
      prompt: `<newsletter>\n${tokenized}\n</newsletter>`,
    })
    cleaned = text.trim() || tokenized
    aiCall = {
      model: CLEANUP_MODEL,
      reasoning: CLEANUP_REASONING,
      instructionsId: instructions.id,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
    }
  } catch {
    // Fall back to the tokenized Turndown output; the model touched nothing.
    cleaned = tokenized
  }

  // Restore exact URLs and drop anything the model produced that isn't one of the
  // Turndown-extracted originals.
  const { text: markdown, removed } = restoreLinks(cleaned, urls)
  return { markdown, aiCall, droppedLinks: removed }
}
