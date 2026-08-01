import type { RunDocument } from '@/brief/corpus'

// "5 RSS feeds" / "1 RSS feed" — a count with its noun, pluralized.
function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`
}

/**
 * The provenance line for a brief: "_Composed from 5 RSS feeds and 7
 * newsletters._" — what the run actually read, counted from the corpus documents
 * rather than claimed by the composer, so it can't drift from reality.
 *
 * Only sources that contributed are counted: a feed that returned nothing, or a
 * newsletter that failed to parse, never becomes a RunDocument. A side with no
 * documents is dropped from the sentence instead of reading "0 RSS feeds" — a
 * backfill skips RSS entirely, so that case is routine. Returns null when nothing
 * contributed at all, leaving "No news today!" to stand on its own.
 *
 * Italic so it renders muted in the email (see the `em` rule in brief/html.ts) and
 * reads as a footer-ish note rather than a section of the brief.
 */
export function provenanceLine(docs: RunDocument[]): string | null {
  const feeds = docs.filter((d) => d.sourceType === 'RSS').length
  const newsletters = docs.filter((d) => d.sourceType === 'NEWSLETTER').length

  const parts: string[] = []
  if (feeds > 0) parts.push(count(feeds, 'RSS feed'))
  if (newsletters > 0) parts.push(count(newsletters, 'newsletter'))
  if (parts.length === 0) return null

  return `_Composed from ${parts.join(' and ')}._`
}

// The shape provenanceLine emits, anchored to the top of a body.
const PROVENANCE_RE = /^_Composed from [^\n]*\._\n*/

/**
 * Drop the provenance line from a stored brief body. Used on the recent briefs
 * handed to the composer as dedup context (alongside the link stripping in
 * ai/compose.ts): the line is bookkeeping about a past run, not content to dedup
 * against, and showing the model a brief that opens with an italic count invites it
 * to imitate one — a number it would have to invent.
 */
export function stripProvenance(body: string): string {
  return body.replace(PROVENANCE_RE, '')
}
