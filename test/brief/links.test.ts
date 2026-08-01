import {
  dropLinksNotIn,
  markdownLinkUrls,
  restoreLinkUrls,
  restoreLinks,
  stripLinks,
  tokenizeLinkUrls,
} from '@/brief/links'
import { describe, expect, it } from 'vitest'

describe('markdownLinkUrls', () => {
  it('extracts link urls in document order', () => {
    const md = 'see [a](https://a.com) and [b](https://b.com "title")'
    expect(markdownLinkUrls(md)).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('dropLinksNotIn', () => {
  it('keeps a link whose url appears verbatim in the haystack', () => {
    const md = 'read [this](https://good.com/x)'
    const { text, removed } = dropLinksNotIn(
      md,
      'corpus … https://good.com/x … end'
    )
    expect(text).toBe(md)
    expect(removed).toEqual([])
  })

  it('strips a link not in the haystack, keeping its label text', () => {
    const md = 'read [this](https://evil.com/x) and [that](https://good.com)'
    const { text, removed } = dropLinksNotIn(md, 'only https://good.com here')
    expect(text).toBe('read this and [that](https://good.com)')
    expect(removed).toEqual(['https://evil.com/x'])
  })
})

describe('tokenize / restore link urls', () => {
  const md = 'a [one](https://a.com/x~~long) and [two](https://b.com/y)'

  it('replaces urls with stable tokens and round-trips exactly', () => {
    const { text, urls } = tokenizeLinkUrls(md)
    expect(text).toBe('a [one]({{LINK0}}) and [two]({{LINK1}})')
    expect(urls).toEqual(['https://a.com/x~~long', 'https://b.com/y'])
    expect(restoreLinkUrls(text, urls)).toBe(md)
  })

  it('restores only the tokens the model kept (dropped links vanish)', () => {
    const { urls } = tokenizeLinkUrls(md)
    // Model kept the first link but removed the second entirely.
    const modelOutput = 'a [one]({{LINK0}})'
    expect(restoreLinkUrls(modelOutput, urls)).toBe(
      'a [one](https://a.com/x~~long)'
    )
  })

  it('leaves a mangled token for the fidelity guard to strip', () => {
    const { urls } = tokenizeLinkUrls(md)
    const restored = restoreLinkUrls('a [one]({{LINK99}})', urls)
    const { text, removed } = dropLinksNotIn(restored, urls.join('\n'))
    expect(text).toBe('a one')
    expect(removed).toEqual(['{{LINK99}}'])
  })

  it('gives a repeated url one token, so identical sources still read alike', () => {
    const dupes =
      '[a](https://x.com/1) [b](https://y.com/2) [c](https://x.com/1)'
    const { text, urls } = tokenizeLinkUrls(dupes)
    expect(text).toBe('[a]({{LINK0}}) [b]({{LINK1}}) [c]({{LINK0}})')
    expect(urls).toEqual(['https://x.com/1', 'https://y.com/2'])
    expect(restoreLinkUrls(text, urls)).toBe(dupes)
  })

  it('round-trips links inside a fenced newsletter block', () => {
    const corpus = [
      '## Newsletters',
      '',
      '### Morning Brew',
      '',
      '```md',
      'The [Fed held rates](https://nyt.com/a?utm=x&y=1) steady.',
      '```',
    ].join('\n')
    const { text, urls } = tokenizeLinkUrls(corpus)
    expect(text).toContain('[Fed held rates]({{LINK0}})')
    expect(urls).toEqual(['https://nyt.com/a?utm=x&y=1'])
    expect(restoreLinkUrls(text, urls)).toBe(corpus)
  })
})

describe('restoreLinks', () => {
  const { urls } = tokenizeLinkUrls(
    '[one](https://a.com/x~~long) [two](https://b.com/y)'
  )

  it('restores exact urls and reports nothing dropped', () => {
    const { text, removed } = restoreLinks('read [one]({{LINK0}})', urls)
    expect(text).toBe('read [one](https://a.com/x~~long)')
    expect(removed).toEqual([])
  })

  it('drops a mangled token and a fabricated url, keeping their labels', () => {
    const { text, removed } = restoreLinks(
      '[a]({{LINK99}}) [b](https://made-up.com) [c]({{LINK1}})',
      urls
    )
    expect(text).toBe('a b [c](https://b.com/y)')
    expect(removed).toEqual(['{{LINK99}}', 'https://made-up.com'])
  })

  it('sweeps an unrestorable token left outside link syntax', () => {
    const { text, removed } = restoreLinks('see {{LINK99}} for more', urls)
    expect(text).toBe('see  for more')
    expect(removed).toEqual([])
  })

  it('restores a bare in-range token rather than sweeping it', () => {
    const { text } = restoreLinks('see {{LINK0}} for more', urls)
    expect(text).toBe('see https://a.com/x~~long for more')
  })
})

describe('stripLinks', () => {
  it('removes link syntax, keeping the label text', () => {
    expect(
      stripLinks('**Fed holds**\n[1](https://a.com) [2](https://b.com "t")')
    ).toBe('**Fed holds**\n1 2')
  })

  it('leaves link-free prose untouched', () => {
    expect(stripLinks('nothing to see here')).toBe('nothing to see here')
  })
})
