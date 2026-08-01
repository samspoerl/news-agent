import { getGmailClient } from '@/gmail/client'
import { randomUUID } from 'node:crypto'

// Gmail REST send endpoint for the authenticated user ("me").
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

export interface SendEmailParams {
  from: string
  to: string
  subject: string
  // Plain-text body (the Markdown brief) — the text/plain fallback part.
  text: string
  // Optional rendered HTML — when present, the message is sent as
  // multipart/alternative so HTML clients render this and others fall back to text.
  html?: string
}

// Header values must be 7-bit; RFC 2047-encode any with non-ASCII (e.g. the em
// dash in the subject). The body carries its own charset, so it's left as-is.
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

/**
 * Build the base64url-encoded RFC 5322 message for Gmail's `raw` field. With an
 * `html` part it emits multipart/alternative (text/plain first, then text/html, in
 * increasing preference per RFC 2046); without it, a single text/plain part as
 * before. Exported for unit tests.
 */
export function buildRawMessage({
  from,
  to,
  subject,
  text,
  html,
}: SendEmailParams): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ]

  let message: string
  if (html) {
    // A UUID boundary — long and random enough to never collide with body content.
    const boundary = `=_boundary_${randomUUID()}`
    message =
      [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ].join('\r\n') +
      '\r\n\r\n' +
      [
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        text,
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
        `--${boundary}--`,
        '',
      ].join('\r\n')
  } else {
    message =
      [
        ...headers,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
      ].join('\r\n') +
      '\r\n\r\n' +
      text
  }
  // Gmail wants the whole RFC 5322 message base64url-encoded in `raw`.
  return Buffer.from(message, 'utf-8').toString('base64url')
}

/**
 * Send an email as the authenticated Gmail account. With `html`, it goes out as
 * multipart/alternative (HTML for clients that render it, the plain-text Markdown
 * as fallback); otherwise plain text only. The account's refresh token is exchanged
 * for an access token automatically; the gmail.modify scope covers sending. Returns
 * the sent message's Gmail id.
 */
export async function sendEmail(
  params: SendEmailParams
): Promise<{ id: string }> {
  const res = await getGmailClient().request<{ id: string }>({
    url: SEND_URL,
    method: 'POST',
    data: { raw: buildRawMessage(params) },
  })
  return { id: res.data.id }
}
