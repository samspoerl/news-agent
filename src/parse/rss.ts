import type { RssFeed } from '@/ingest/rss'

/**
 * Render one RSS feed as a titled Markdown section for the corpus — deterministic,
 * so URLs never pass through a model. Shape mirrors prompt-tests/prompt1.md:
 *
 *   ### [Feed Name](feed-url)
 *   _feed description_
 *
 *   [**Entry title**](entry-url)
 *   Entry dek.
 *
 * Entries with no dek render as just the linked title; entries with no URL render
 * as bold text (no link) rather than a broken link.
 */
export function renderRssMarkdown(feed: RssFeed): string {
  const lines: string[] = [
    `### [${feed.source.name}](${feed.source.identifier})`,
  ]
  if (feed.description) lines.push(`_${feed.description}_`)
  lines.push('')

  for (const entry of feed.entries) {
    const heading = entry.url
      ? `[**${entry.title}**](${entry.url})`
      : `**${entry.title}**`
    // Two trailing spaces = a hard line break, so the dek sits under the title.
    lines.push(entry.dek ? `${heading}  ` : heading)
    if (entry.dek) lines.push(entry.dek)
    lines.push('')
  }

  return lines.join('\n').trim() + '\n'
}
