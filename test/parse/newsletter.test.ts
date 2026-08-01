import { htmlToRoughMarkdown } from '@/parse/newsletter'
import { describe, expect, it } from 'vitest'

describe('htmlToRoughMarkdown', () => {
  it('converts content and strips style/script noise', () => {
    const html = `<html><head><style>.x{color:red}</style></head><body>
      <script>evil()</script>
      <h1>Title</h1>
      <p>Hello <a href="https://a.com">world</a></p>
    </body></html>`
    const md = htmlToRoughMarkdown(html)
    expect(md).toContain('# Title')
    expect(md).toContain('[world](https://a.com)')
    expect(md).not.toContain('color:red')
    expect(md).not.toContain('evil()')
  })

  it('drops HTML comments (e.g. tracking pixels)', () => {
    const md = htmlToRoughMarkdown('<p>keep<!-- tracking pixel --></p>')
    expect(md).toContain('keep')
    expect(md).not.toContain('tracking pixel')
  })
})
