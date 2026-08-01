import { buildRawMessage } from '@/gmail/send'
import { describe, expect, it } from 'vitest'

// Gmail's `raw` is the whole RFC 5322 message base64url-encoded; decode to inspect.
function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8')
}

const base = {
  from: 'from@example.com',
  to: 'to@example.com',
  subject: 'Daily News Brief',
}

describe('buildRawMessage', () => {
  it('emits multipart/alternative with text and html parts when html is present', () => {
    const msg = decode(
      buildRawMessage({ ...base, text: '# Hi', html: '<h1>Hi</h1>' })
    )
    const boundary = msg.match(
      /Content-Type: multipart\/alternative; boundary="([^"]+)"/
    )?.[1]
    expect(boundary).toBeTruthy()

    // Both alternatives present, text/plain before text/html (increasing preference).
    const plainAt = msg.indexOf('Content-Type: text/plain; charset="UTF-8"')
    const htmlAt = msg.indexOf('Content-Type: text/html; charset="UTF-8"')
    expect(plainAt).toBeGreaterThan(-1)
    expect(htmlAt).toBeGreaterThan(plainAt)

    // Bodies land in their parts and the multipart is terminated.
    expect(msg).toContain('# Hi')
    expect(msg).toContain('<h1>Hi</h1>')
    expect(msg).toContain(`--${boundary}--`)
  })

  it('emits a single text/plain part when html is absent (backward compatible)', () => {
    const msg = decode(buildRawMessage({ ...base, text: 'plain body' }))
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(msg).not.toContain('multipart/alternative')
    expect(msg).toContain('plain body')
  })

  it('RFC 2047-encodes a non-ASCII subject', () => {
    const msg = decode(
      buildRawMessage({
        ...base,
        subject: 'Daily News Brief — Jul 21, 2026',
        text: 'x',
      })
    )
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/)
  })
})
