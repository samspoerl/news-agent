import { toPlainText } from '@/ai/utils'
import prisma from '@/prisma'
import Parser from 'rss-parser'

// A browser-like User-Agent: some feeds (e.g. Cloudflare-fronted ones like
// TechCrunch) reject the default agent with a 403.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 20_000
const parser = new Parser()

// Deks longer than this rarely add signal past the lede; cap to control tokens.
const DEK_CHARS = 500

/** One feed entry, normalized for the deterministic Markdown renderer. */
export interface RssEntry {
  title: string
  url: string | null // Click-through link (prefer <link>, fall back to guid).
  dek: string | null // Cleaned one-liner from the entry summary/content.
  publishedAt: Date | null
}

/** One feed's worth of content for a single run: raw XML plus parsed entries. */
export interface RssFeed {
  source: { id: number; name: string; identifier: string }
  description: string | null
  buildDate: Date | null // Feed-level lastBuildDate (RSS) / updated (Atom), if any.
  rawXml: string
  entries: RssEntry[]
}

// Parse a feed's channel-level timestamp, tolerating the missing/garbage values
// many feeds emit. Stored as provenance only — never used to skip or dedup a feed.
function parseFeedDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

// Fetch the raw feed XML ourselves (so we can store it and re-run the parser for
// evals), then parse the string. rss-parser normalizes the feed idiosyncrasies
// we'd otherwise hand-handle: guid vs link, summary vs description, CDATA, etc.
async function fetchFeed(source: {
  id: number
  name: string
  identifier: string
}): Promise<RssFeed> {
  const res = await fetch(source.identifier, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const rawXml = await res.text()
  const feed = await parser.parseString(rawXml)

  const seen = new Set<string>()
  const entries = feed.items.flatMap<RssEntry>((entry) => {
    const url = entry.link ?? entry.guid ?? null
    const key = url ?? entry.title ?? ''
    if (key && seen.has(key)) return [] // de-dupe within the feed
    if (key) seen.add(key)
    return {
      title: entry.title?.trim() || '(untitled)',
      url,
      dek:
        toPlainText(
          entry.contentSnippet ?? entry.content ?? entry.summary ?? null,
          DEK_CHARS
        ) || null,
      publishedAt: entry.isoDate ? new Date(entry.isoDate) : null,
    }
  })

  return {
    source,
    description: feed.description?.trim() || null,
    // rss-parser surfaces RSS <lastBuildDate>; Atom's <updated> isn't in its
    // default field set, so read it off the untyped feed object.
    buildDate: parseFeedDate(
      feed.lastBuildDate ?? (feed as { updated?: string }).updated
    ),
    rawXml,
    entries,
  }
}

/**
 * Fetch every active RSS source into memory — raw XML plus parsed entries — with
 * no DB writes. Reads only the source config (which feeds are active). A failing
 * feed is collected as an error, never fatal, so one bad feed never sinks a run.
 */
export async function fetchRssFeeds(): Promise<{
  feeds: RssFeed[]
  errors: { source: string; error: string }[]
}> {
  const sources = await prisma.source.findMany({
    where: { type: 'RSS', active: true },
    orderBy: { id: 'asc' },
  })

  const feeds: RssFeed[] = []
  const errors: { source: string; error: string }[] = []
  for (const source of sources) {
    try {
      feeds.push(await fetchFeed(source))
    } catch (err) {
      errors.push({
        source: source.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { feeds, errors }
}
