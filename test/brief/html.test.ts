import { renderBriefHtml } from '@/brief/html'
import { describe, expect, it } from 'vitest'

describe('renderBriefHtml', () => {
  it('renders a full HTML document shell', () => {
    const html = renderBriefHtml('Hello')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('</html>')
  })

  it('converts headings, bold headlines, and links from the brief Markdown', () => {
    const md = [
      '## Need to Know',
      '',
      '**Fed holds rates steady**',
      '',
      'The central bank left rates unchanged.',
      '',
      '[1](https://a.com/x?y=1) [2](https://b.com)',
    ].join('\n')
    const html = renderBriefHtml(md)
    expect(html).toContain('<h2>Need to Know</h2>')
    expect(html).toContain('<strong>Fed holds rates steady</strong>')
    // URLs must survive verbatim — the brief's value is the click-through.
    expect(html).toContain('href="https://a.com/x?y=1"')
    expect(html).toContain('href="https://b.com"')
  })

  it('renders the empty-corpus body sanely', () => {
    const html = renderBriefHtml('No news today!')
    expect(html).toContain('No news today!')
  })

  it('renders an empty-section italic line', () => {
    const html = renderBriefHtml('## Tech\n\n_Nothing today._')
    expect(html).toContain('<em>Nothing today.</em>')
  })
})
