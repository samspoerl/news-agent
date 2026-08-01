import type { RunDocument } from '@/brief/corpus'
import { provenanceLine, stripProvenance } from '@/brief/provenance'
import { describe, expect, it } from 'vitest'

// A minimal RunDocument — provenance reads only `sourceType`.
function doc(sourceType: RunDocument['sourceType']): RunDocument {
  return {
    sourceType,
    sourceId: null,
    sourceName: 'Source',
    sourceIdentifier: 'source',
    raw: '',
    markdown: '',
    cleanup: null,
    gmailMessageId: null,
    feedBuildDate: null,
  }
}

const rss = (n: number) => Array.from({ length: n }, () => doc('RSS'))
const news = (n: number) => Array.from({ length: n }, () => doc('NEWSLETTER'))

describe('provenanceLine', () => {
  it('counts both source types', () => {
    expect(provenanceLine([...rss(5), ...news(7)])).toBe(
      '_Composed from 5 RSS feeds and 7 newsletters._'
    )
  })

  it('uses singular nouns for a count of one', () => {
    expect(provenanceLine([...rss(1), ...news(1)])).toBe(
      '_Composed from 1 RSS feed and 1 newsletter._'
    )
  })

  it('omits a source type that contributed nothing', () => {
    // The backfill shape: newsletters only, no RSS.
    expect(provenanceLine(news(3))).toBe('_Composed from 3 newsletters._')
    expect(provenanceLine(rss(2))).toBe('_Composed from 2 RSS feeds._')
  })

  it('returns null when nothing contributed', () => {
    expect(provenanceLine([])).toBeNull()
  })
})

describe('stripProvenance', () => {
  it('removes a leading provenance line and its blank line', () => {
    const body = `${provenanceLine([...rss(5), ...news(7)])}\n\n## Need to Know\n\nStory`
    expect(stripProvenance(body)).toBe('## Need to Know\n\nStory')
  })

  it('leaves a body without one untouched', () => {
    expect(stripProvenance('## Need to Know\n\nStory')).toBe(
      '## Need to Know\n\nStory'
    )
    expect(stripProvenance('No news today!')).toBe('No news today!')
  })

  it('only strips at the top, not an italic line mid-brief', () => {
    const body = '## Tech\n\n_Composed from 2 newsletters._'
    expect(stripProvenance(body)).toBe(body)
  })
})
