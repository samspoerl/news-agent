import { getGmailClient } from '@/gmail/client'

// Gmail REST message endpoints for the authenticated user ("me").
const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'

// A newsletter email flattened to the bits we ingest. `html` is the raw
// text/html payload (preferred) or text/plain fallback — the parse stage turns
// it into clean Markdown (strip + Turndown + model). `from` is the raw From header.
export interface NewsletterMessage {
  id: string
  from: string | undefined
  subject: string
  receivedAt: Date | null
  html: string
}

// A parsed From header: the address plus a display name (falls back to address).
export interface Sender {
  email: string
  name: string
}

// The slices of Gmail's Message resource we actually read.
interface MessagePart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string }
  parts?: MessagePart[]
}
interface GmailMessage {
  id: string
  internalDate?: string
  payload?: MessagePart
}

const decode = (data: string): string =>
  Buffer.from(data, 'base64url').toString('utf-8')

function header(
  payload: MessagePart | undefined,
  name: string
): string | undefined {
  return payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )?.value
}

// Walk the MIME tree and pull out the message body: prefer the first text/html
// part (richest structure + links for Turndown), fall back to text/plain.
// Attachments (which carry a filename) are skipped so a .txt attachment can't
// masquerade as the body.
function extractBody(payload: MessagePart | undefined): string {
  let plain = ''
  let html = ''
  const walk = (part: MessagePart): void => {
    const data = part.body?.data
    if (data && !part.filename) {
      if (part.mimeType === 'text/plain' && !plain) plain = decode(data)
      else if (part.mimeType === 'text/html' && !html) html = decode(data)
    }
    for (const child of part.parts ?? []) walk(child)
  }
  if (payload) walk(payload)
  return html || plain
}

/**
 * Pull the address and display name out of a raw From header
 * (`Alice <a@x.com>` or `a@x.com`); returns null if there's no usable address.
 * The display name is sender-controlled, so it's stripped of control characters
 * and capped before we ever store it or put it in a prompt.
 */
export function parseSender(from: string | undefined): Sender | null {
  if (!from) return null
  const angle = from.match(/<([^>]+)>/)
  const email = (angle ? angle[1] : from).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null
  const rawName = angle ? from.slice(0, angle.index).trim() : ''
  const name =
    rawName
      .replace(/^"|"$/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 200) || email
  return { email, name }
}

/**
 * List the ids of messages matching a Gmail search query (e.g.
 * `in:inbox newer_than:2d`). Returns an empty array when nothing matches.
 */
export async function listMessageIds(
  query: string,
  maxResults = 50
): Promise<string[]> {
  const { data } = await getGmailClient().request<{
    messages?: { id: string }[]
  }>({
    url: MESSAGES_URL,
    params: { q: query, maxResults },
  })
  return (data.messages ?? []).map((m) => m.id)
}

/** Fetch a single message and flatten it to sender, subject, received time, body. */
export async function getMessage(id: string): Promise<NewsletterMessage> {
  const { data } = await getGmailClient().request<GmailMessage>({
    url: `${MESSAGES_URL}/${id}`,
    params: { format: 'full' },
  })
  return {
    id: data.id,
    from: header(data.payload, 'From'),
    subject: header(data.payload, 'Subject')?.trim() || '(no subject)',
    // internalDate is Gmail's received timestamp in epoch milliseconds.
    receivedAt: data.internalDate ? new Date(Number(data.internalDate)) : null,
    html: extractBody(data.payload),
  }
}
