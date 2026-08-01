import type { AiCallData } from '@/ai/types'

/**
 * One source's contribution to a run, carried in memory from parse to persist.
 * `sourceId` is set for RSS (already in the DB, seeded); newsletters are upserted
 * by `sourceIdentifier` at persist time. `cleanup` is the newsletter cleanup call
 * (null for RSS, for newsletters that fell back to Turndown-only, and for
 * newsletters whose Markdown was reused from a prior run). `gmailMessageId` (the
 * newsletter reuse key) and `feedBuildDate` (RSS provenance) are each set only for
 * their source type; see SourceDocument in the schema.
 */
export interface RunDocument {
  sourceType: 'RSS' | 'NEWSLETTER'
  sourceId: number | null
  sourceName: string
  sourceIdentifier: string
  raw: string
  markdown: string
  cleanup: AiCallData | null
  gmailMessageId: string | null
  feedBuildDate: Date | null
}

// Wrap newsletter Markdown in a fenced block so its own #/## headers can't be
// confused with the corpus structure. Uses a backtick run one longer than any in
// the content, so embedded fences don't break out.
function fence(content: string): string {
  const runs = [...content.matchAll(/`+/g)].map((m) => m[0].length)
  const ticks = '`'.repeat(Math.max(3, Math.max(0, ...runs) + 1))
  return `${ticks}md\n${content}\n${ticks}`
}

/**
 * Assemble the run's documents into the single Markdown corpus handed to the
 * composer. RSS feeds already carry their own `### [name](url)` headers; each is
 * separated by a rule. Newsletters get a `### sender` header and a fenced body,
 * grouped under their own heading so editorial content reads as distinct from the
 * higher-volume RSS stream.
 */
export function buildCorpus(docs: RunDocument[]): string {
  const rss = docs.filter((d) => d.sourceType === 'RSS')
  const newsletters = docs.filter((d) => d.sourceType === 'NEWSLETTER')

  const parts: string[] = ['# News Sources']

  if (rss.length) {
    parts.push('## RSS Feeds')
    parts.push(rss.map((d) => d.markdown.trim()).join('\n\n---\n\n'))
  }

  if (newsletters.length) {
    parts.push('## Newsletters')
    parts.push(
      newsletters
        .map((d) => `### ${d.sourceName}\n\n${fence(d.markdown.trim())}`)
        .join('\n\n')
    )
  }

  return parts.join('\n\n').trim() + '\n'
}
