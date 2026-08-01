import {
  getMessage,
  listMessageIds,
  parseSender,
  type NewsletterMessage,
  type Sender,
} from '@/gmail/read'
import prisma from '@/prisma'

// How far back a scheduled run searches. An hour more than the daily cadence,
// because the cron doesn't fire at a fixed minute — GitHub Actions queues a
// scheduled run and can start it up to an hour late. A flat 24h window measured
// from an early start would end before a late one begins, and mail that arrived in
// the gap would never be seen by either run. The extra hour makes consecutive
// windows overlap instead. Re-reading the same email is harmless: a successful run
// archives what it used, and the query keeps `in:inbox`.
//
// A dated run (`--date`) supplies explicit bounds instead and never consults this.
const LOOKBACK_HOURS = 25
const HOUR_MS = 60 * 60 * 1000

// A ceiling on messages pulled per run, so a busy window can't balloon the batch.
const MAX_MESSAGES = 50

// Structural senders never worth ingesting — Google's own account/security mail.
// Muting an actual newsletter is done in the DB instead (set its Source
// `active: false`); those addresses are excluded from the query the same way.
const IGNORED_SENDERS = ['no-reply@accounts.google.com']

// A fixed, hand-labeled Gmail search read by `--sample-inbox` runs, for a
// reproducible pipeline run that doesn't depend on the day's live inbox.
// Hardcoded, not env-driven, so it can only ever point at this one label.
export const SAMPLE_INBOX_QUERY = 'label:TEST'

/** One newsletter email flattened for the parse stage: attribution + raw HTML. */
export interface NewsletterDoc {
  gmailMessageId: string // Stable Gmail id — the reuse key across the lookback window.
  senderName: string
  senderEmail: string
  subject: string
  receivedAt: Date | null
  html: string
}

/** A half-open `[start, end)` mail window, for reconstructing a specific past day. */
export interface DateWindow {
  start: Date
  end: Date
}

// Gmail's after:/before: accept Unix seconds. The YYYY/MM/DD form is only
// day-granular and resolves in the account's timezone, so it can't express a
// window whose edges sit at 05:00 UTC.
function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

// Resolve the Gmail search for a run: the fixed SAMPLE_INBOX_QUERY when requested,
// else the live inbox minus structural noise and any user-muted senders (Source
// active: false). Reads only config, never item state.
//
// A `window` replaces the relative lookback with explicit bounds — the only
// difference between a daily run and a backfill. `in:inbox` stays either way: it
// is the de-facto "not yet briefed" filter, since a successful run archives what
// it used, so a backfill can't resurrect a day that already went out.
async function resolveQuery(
  sampleInbox: boolean,
  window?: DateWindow
): Promise<string> {
  if (sampleInbox) return SAMPLE_INBOX_QUERY
  const muted = await prisma.source.findMany({
    where: { type: 'NEWSLETTER', active: false },
    select: { identifier: true },
  })
  const excluded = [...IGNORED_SENDERS, ...muted.map((m) => m.identifier)]
  // `newer_than:` is day-granular (its units are d/m/y), so the rolling lookback
  // uses the same epoch-seconds `after:` form as an explicit window.
  const range = window
    ? `after:${epochSeconds(window.start)} before:${epochSeconds(window.end)}`
    : `after:${epochSeconds(new Date(Date.now() - LOOKBACK_HOURS * HOUR_MS))}`
  return `in:inbox ${range} ${excluded
    .map((addr) => `-from:${addr}`)
    .join(' ')}`.trim()
}

// Fetch and parse the messages matching the query into (sender, message) pairs —
// no DB writes. A message that fails to fetch or parse is skipped, not fatal.
async function fetchMessages(
  sampleInbox: boolean,
  window?: DateWindow
): Promise<{ sender: Sender; message: NewsletterMessage }[]> {
  const query = await resolveQuery(sampleInbox, window)
  console.log(`  query: ${query}`)
  const ids = await listMessageIds(query, MAX_MESSAGES)
  // listMessageIds reads a single page, so a full batch means the window may hold
  // more mail than was fetched. Say so — silent truncation would otherwise read as
  // a quiet news day.
  if (ids.length === MAX_MESSAGES)
    console.log(
      `  ! hit the ${MAX_MESSAGES}-message ceiling; older mail in this window was not fetched.`
    )
  const out: { sender: Sender; message: NewsletterMessage }[] = []
  for (const id of ids) {
    try {
      const message = await getMessage(id)
      const sender = parseSender(message.from)
      if (!sender) continue
      out.push({ sender, message })
    } catch {
      // Skip this message; the rest of the batch still processes.
    }
  }
  return out
}

// Enforce the window client-side. Gmail's timestamp handling on after:/before: is
// not a documented contract, so the fetched `internalDate` is the authority on
// which day an email belongs to. A message with no receivedAt is kept — Gmail
// always sets internalDate, and the query already bounded it.
function withinWindow(receivedAt: Date | null, window: DateWindow): boolean {
  if (!receivedAt) return true
  const at = receivedAt.getTime()
  return at >= window.start.getTime() && at < window.end.getTime()
}

/**
 * Allow-by-default newsletter intake: fetch recent inbox mail into in-memory
 * documents (raw HTML + attribution), minus an ignore list and any muted senders.
 * No DB writes — senders are registered as Sources at persist time, after a
 * successful send. Returns an error string instead of throwing so a Gmail hiccup
 * doesn't abort the run before the brief is sent.
 *
 * Pass `{ sampleInbox: true }` to read the fixed SAMPLE_INBOX_QUERY sample instead
 * of the live inbox — a stable, repeatable set for pipeline runs.
 *
 * Pass `{ window }` to scope intake to one past day instead of the rolling
 * lookback, for reconstructing a run that never happened.
 */
export async function fetchNewsletters({
  sampleInbox = false,
  window,
}: { sampleInbox?: boolean; window?: DateWindow } = {}): Promise<{
  docs: NewsletterDoc[]
  error?: string
}> {
  try {
    const fetched = await fetchMessages(sampleInbox, window)
    const docs: NewsletterDoc[] = fetched
      .map(({ sender, message }) => ({
        gmailMessageId: message.id,
        senderName: sender.name,
        senderEmail: sender.email,
        subject: message.subject,
        receivedAt: message.receivedAt,
        html: message.html,
      }))
      .filter((doc) => !window || withinWindow(doc.receivedAt, window))
    const excluded = fetched.length - docs.length
    if (excluded)
      console.log(`  · ${excluded} message(s) fell outside the window.`)
    return { docs }
  } catch (err) {
    return {
      docs: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
