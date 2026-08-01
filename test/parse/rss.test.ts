import type { RssFeed } from '@/ingest/rss'
import { renderRssMarkdown } from '@/parse/rss'
import { describe, expect, it } from 'vitest'

const feed: RssFeed = {
  source: { id: 1, name: 'Example', identifier: 'https://ex.com/feed' },
  description: 'A feed',
  buildDate: null,
  rawXml: '<xml/>',
  entries: [
    {
      title: 'First',
      url: 'https://ex.com/1',
      dek: 'The first one.',
      publishedAt: null,
    },
    { title: 'No link', url: null, dek: null, publishedAt: null },
  ],
}

describe('renderRssMarkdown', () => {
  it('renders the feed header, description, and linked entries', () => {
    const md = renderRssMarkdown(feed)
    expect(md).toContain('### [Example](https://ex.com/feed)')
    expect(md).toContain('_A feed_')
    expect(md).toContain('[**First**](https://ex.com/1)')
    expect(md).toContain('The first one.')
  })

  it('renders a url-less entry as bold text, never a broken link', () => {
    const md = renderRssMarkdown(feed)
    expect(md).toContain('**No link**')
    expect(md).not.toContain('](null)')
  })
})
