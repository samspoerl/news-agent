import { buildCorpus, type RunDocument } from '@/brief/corpus'
import { describe, expect, it } from 'vitest'

const rssDoc: RunDocument = {
  sourceType: 'RSS',
  sourceId: 1,
  sourceName: 'Feed',
  sourceIdentifier: 'https://f.com',
  raw: '<xml/>',
  markdown: '### [Feed](https://f.com)\n\n[**A**](https://f.com/a)',
  cleanup: null,
  gmailMessageId: null,
  feedBuildDate: null,
}
const newsDoc: RunDocument = {
  sourceType: 'NEWSLETTER',
  sourceId: null,
  sourceName: 'Sender',
  sourceIdentifier: 's@x.com',
  raw: '<html/>',
  markdown: '# Issue\n\nBody',
  cleanup: null,
  gmailMessageId: 'msg-1',
  feedBuildDate: null,
}

describe('buildCorpus', () => {
  it('groups RSS and newsletters under their own headings', () => {
    const corpus = buildCorpus([rssDoc, newsDoc])
    expect(corpus).toContain('# News Sources')
    expect(corpus).toContain('## RSS Feeds')
    expect(corpus).toContain('## Newsletters')
    expect(corpus).toContain('### Sender')
    expect(corpus).toContain('```md') // newsletter body is fenced
    expect(corpus).toContain('# Issue')
  })

  it('omits an empty group', () => {
    const corpus = buildCorpus([rssDoc])
    expect(corpus).toContain('## RSS Feeds')
    expect(corpus).not.toContain('## Newsletters')
  })

  it('uses a longer fence when the newsletter body contains backticks', () => {
    const withTicks: RunDocument = {
      ...newsDoc,
      markdown: 'code ```js\nx\n```',
    }
    const corpus = buildCorpus([withTicks])
    expect(corpus).toContain('````md') // 4 backticks wrap a 3-backtick body
  })
})
