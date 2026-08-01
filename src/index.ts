import 'dotenv/config'
import { composeBrief } from '@/ai/compose'
import { DEFAULT_INSTRUCTIONS, type AiTaskName } from '@/ai/instructions'
import type { AiCallData, InstructionSet } from '@/ai/types'
import { buildCorpus, type RunDocument } from '@/brief/corpus'
import { renderBriefHtml } from '@/brief/html'
import { provenanceLine, stripProvenance } from '@/brief/provenance'
import { markProcessed, PROCESSED_LABEL } from '@/gmail/labels'
import { sendEmail } from '@/gmail/send'
import {
  fetchNewsletters,
  SAMPLE_INBOX_QUERY,
  type DateWindow,
} from '@/ingest/newsletters'
import { fetchRssFeeds } from '@/ingest/rss'
import { parseNewsletter } from '@/parse/newsletter'
import { renderRssMarkdown } from '@/parse/rss'
import prisma from '@/prisma'
import { mapWithConcurrency } from '@/util/concurrency'
import {
  dayWindow,
  formatBriefDate,
  parseIsoDate,
  resolveBriefDate,
} from '@/util/day'
import { pathToFileURL } from 'node:url'
import { parseArgs as parseNodeArgs } from 'node:util'

// How many newsletter cleanup calls to run at once, and how many prior briefs to
// hand the composer as cross-day dedup context.
const PARSE_CONCURRENCY = 6
const RECENT_BRIEFS = 2

// Display name shown as the brief's From in recipients' inboxes. The address comes
// from BRIEF_SENDER; this is the human-readable label paired with it in the header.
const SENDER_NAME = 'Agent Brief'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`Missing ${name} — set it in .env / Actions secrets.`)
  return value
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// "Daily News Brief — Jul 19, 2026" — the day the brief covers, not the day it was
// sent. The two differ only for a backfill.
function briefSubject(briefDate: Date): string {
  return `Daily News Brief — ${formatBriefDate(briefDate)}`
}

/**
 * Resolve the current prompt version for a task: the latest `Instructions` row.
 * If a task has none (e.g. an unseeded DB), fall back to the code default —
 * self-healing into a persisted row on a real run so every AiCall references an
 * exact version. A dry run never writes, so it uses the default in memory.
 */
async function resolveInstructions(
  task: AiTaskName,
  persist: boolean
): Promise<InstructionSet> {
  const row = await prisma.instructions.findFirst({
    where: { task },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  if (row) return { id: row.id, body: row.body }

  if (persist) {
    const created = await prisma.instructions.create({
      data: {
        task,
        body: DEFAULT_INSTRUCTIONS[task],
        note: 'auto-seeded fallback',
      },
    })
    return { id: created.id, body: created.body }
  }
  return { id: -1, body: DEFAULT_INSTRUCTIONS[task] }
}

/**
 * Fetch and parse the current world into corpus documents: RSS deterministically,
 * newsletters via strip + Turndown + model cleanup (bounded and fault-tolerant —
 * one failing feed or newsletter is skipped, never fatal). No DB writes.
 *
 * A newsletter already cleaned by a prior run (matched on its Gmail id) reuses that
 * stored Markdown instead of re-calling the cleanup model — a missed run's overlap
 * would otherwise mean an email gets cleaned twice. This holds for dry runs too:
 * the pipeline behaves like production minus the side effects, so cleanup reuse and
 * cross-day dedup stay on; only send + persist are gated (repeatability belongs to
 * evals, not the pipeline run).
 *
 * A `window` narrows newsletters to one past day and skips RSS entirely: feeds serve
 * only what they hold right now, so a past day is unrecoverable from them and a
 * today's-headlines section would misrepresent the day being rebuilt.
 */
async function gather({
  sampleInbox,
  cleanupInstructions,
  window,
}: {
  sampleInbox: boolean
  cleanupInstructions: InstructionSet
  window?: DateWindow
}): Promise<RunDocument[]> {
  let rssDocs: RunDocument[] = []
  if (window) {
    console.log('Skipping RSS — feeds carry only current items.')
  } else {
    console.log('Fetching RSS feeds…')
    const rss = await fetchRssFeeds()
    for (const e of rss.errors) console.log(`  ✗ ${e.source}: ${e.error}`)
    rssDocs = rss.feeds
      .filter((feed) => feed.entries.length > 0)
      .map((feed) => ({
        sourceType: 'RSS',
        sourceId: feed.source.id,
        sourceName: feed.source.name,
        sourceIdentifier: feed.source.identifier,
        raw: feed.rawXml,
        markdown: renderRssMarkdown(feed),
        cleanup: null,
        gmailMessageId: null,
        feedBuildDate: feed.buildDate,
      }))
  }

  console.log('Fetching newsletters…')
  const news = await fetchNewsletters({ sampleInbox, window })
  if (news.error) console.log(`  ✗ (gmail): ${news.error}`)

  console.log(`Parsing ${news.docs.length} newsletter(s)…`)
  const parsed = await mapWithConcurrency(
    news.docs,
    PARSE_CONCURRENCY,
    async (message): Promise<RunDocument | null> => {
      const base = {
        sourceType: 'NEWSLETTER' as const,
        sourceId: null,
        sourceName: message.senderName,
        sourceIdentifier: message.senderEmail,
        raw: message.html,
        gmailMessageId: message.gmailMessageId,
        feedBuildDate: null,
      }
      try {
        // Reuse a prior run's cleaned Markdown for this exact email (matched on
        // Gmail id) instead of re-paying the cleanup model. The stored Markdown
        // already passed the link-fidelity guard, so no cleanup call is recorded.
        const prior = await prisma.sourceDocument.findFirst({
          where: { gmailMessageId: message.gmailMessageId },
          orderBy: { createdAt: 'desc' },
          select: { markdown: true },
        })
        if (prior?.markdown.trim()) {
          console.log(`  ↺ ${message.senderName}: reused prior cleanup`)
          return { ...base, markdown: prior.markdown, cleanup: null }
        }

        const { markdown, aiCall, droppedLinks } = await parseNewsletter(
          message.html,
          cleanupInstructions
        )
        if (droppedLinks.length)
          console.log(
            `  ! ${message.senderName}: dropped ${droppedLinks.length} unverifiable link(s)`
          )
        if (!markdown.trim()) return null
        return { ...base, markdown, cleanup: aiCall }
      } catch (err) {
        console.log(
          `  ✗ ${message.senderName}: parse failed — ${errMessage(err)}`
        )
        return null
      }
    }
  )
  const newsletterDocs = parsed.filter((d): d is RunDocument => d !== null)

  const docs = [...rssDocs, ...newsletterDocs]
  console.log(
    `Corpus: ${rssDocs.length} feed(s) + ${newsletterDocs.length} newsletter(s).`
  )
  return docs
}

/**
 * Compose the brief body from the corpus. `composeBrief` tokenizes the corpus links,
 * restores them, and drops any link the composer produced that isn't in the corpus,
 * so the body comes back ready to send. An empty corpus short-circuits to
 * "No news today!" with no model call. `composeCall` is null only in that case.
 *
 * The provenance line is prepended here rather than asked of the composer: counting
 * its own inputs is something code can do exactly and a model can only approximate.
 * It becomes part of the stored body, so the record matches what was sent.
 */
async function composeBody(
  docs: RunDocument[],
  corpus: string,
  instructions: InstructionSet,
  recentBriefs: string[]
): Promise<{ body: string; composeCall: AiCallData | null }> {
  if (docs.length === 0) return { body: 'No news today!', composeCall: null }

  console.log('Composing brief…')
  const { body, aiCall, droppedLinks } = await composeBrief(
    corpus,
    instructions,
    recentBriefs
  )
  if (droppedLinks.length)
    console.log(
      `  ! composer produced ${droppedLinks.length} unverifiable link(s); dropped.`
    )
  const provenance = provenanceLine(docs)
  return {
    body: provenance ? `${provenance}\n\n${body}` : body,
    composeCall: aiCall,
  }
}

/**
 * Record the sent brief, its corpus, every source document (raw + Markdown), and
 * every AI call — atomically, after a successful send. RSS sources already exist
 * (seeded); newsletter senders are upserted here so they carry attribution and
 * can be muted (Source active: false) later.
 */
async function persist(input: {
  sender: string
  recipient: string
  subject: string
  body: string
  corpus: string
  briefDate: Date
  docs: RunDocument[]
  composeCall: AiCallData | null
}): Promise<{ id: number }> {
  const {
    sender,
    recipient,
    subject,
    body,
    corpus,
    briefDate,
    docs,
    composeCall,
  } = input
  return prisma.$transaction(
    async (tx) => {
      const brief = await tx.brief.create({
        data: { sender, recipient, subject, body, corpus, briefDate },
      })
      // `lastFetchedAt` below stays wall-clock now, even on a backfill: it records
      // when a source was last pulled, which is genuinely this moment.
      const now = new Date()
      for (const doc of docs) {
        let sourceId: number
        if (doc.sourceId != null) {
          await tx.source.update({
            where: { id: doc.sourceId },
            data: { lastFetchedAt: now },
          })
          sourceId = doc.sourceId
        } else {
          const source = await tx.source.upsert({
            where: {
              type_identifier: {
                type: 'NEWSLETTER',
                identifier: doc.sourceIdentifier,
              },
            },
            create: {
              type: 'NEWSLETTER',
              name: doc.sourceName,
              identifier: doc.sourceIdentifier,
              lastFetchedAt: now,
            },
            update: { name: doc.sourceName, lastFetchedAt: now },
          })
          sourceId = source.id
        }
        const document = await tx.sourceDocument.create({
          data: {
            sourceId,
            briefId: brief.id,
            raw: doc.raw,
            markdown: doc.markdown,
            gmailMessageId: doc.gmailMessageId,
            feedBuildDate: doc.feedBuildDate,
          },
        })
        if (doc.cleanup)
          await tx.aiCall.create({
            data: {
              task: 'NEWSLETTER_CLEANUP',
              ...doc.cleanup,
              sourceDocumentId: document.id,
            },
          })
      }
      if (composeCall)
        await tx.aiCall.create({
          data: { task: 'COMPOSE', ...composeCall, briefId: brief.id },
        })
      return brief
    },
    { timeout: 60_000, maxWait: 15_000 }
  )
}

/** Runtime options for a single pipeline run, resolved from CLI flags. */
export interface RunOptions {
  // Fetch → parse → compose, then print instead of send/persist. The pipeline
  // still behaves like production up to that point (reads history, reuses cleanup).
  dryRun: boolean
  // Read newsletters from the fixed `label:TEST` sample instead of the live inbox,
  // for a reproducible pipeline run that doesn't depend on today's mail.
  sampleInbox: boolean
  // Print the assembled corpus (the exact composer input). Off by default — a full
  // corpus is large; opt in when tuning sources/parsing.
  printCorpus: boolean
  // Rebuild one past day (`--date YYYY-MM-DD`) instead of running for today:
  // newsletters only, scoped to that day's mail. Null for a normal run, where the
  // day is resolved from the clock instead.
  briefDate: Date | null
}

/**
 * The Gmail ids of the newsletters a run should mark processed: those that made
 * the corpus (parsed and persisted). RSS docs and any newsletter without a Gmail
 * id are excluded; a parse failure never reaches `docs`, so its email is left in
 * the inbox to retry. Pure so it can be unit-tested apart from the Gmail call.
 */
export function newsletterMessageIds(docs: RunDocument[]): string[] {
  return docs
    .filter((doc) => doc.sourceType === 'NEWSLETTER' && doc.gmailMessageId)
    .map((doc) => doc.gmailMessageId as string)
}

const USAGE =
  'Usage: tsx src/index.ts [--dry-run] [--sample-inbox] [--print-corpus] [--date YYYY-MM-DD]'

/**
 * Resolve the flags of argv into RunOptions, on Node's own `util.parseArgs`. Takes
 * argv already sliced past the node and script paths — see the call site. Pure and
 * side-effect free so it can be unit-tested.
 *
 * Every mistake here is expensive — the failure mode of a mistyped flag is a live
 * send of the wrong brief — so parsing is strict: an unknown flag, a `--date` with
 * no value, a `--date` swallowing the next flag, and anything that isn't a flag at
 * all abort the run. Strict is also the only workable mode, not merely the safer
 * one: with `strict: false`, `--date --dry-run` silently binds "--dry-run" as the
 * date and drops the dry run, turning a preview into a send.
 */
export function parseArgs(
  argv: readonly string[],
  now = new Date()
): RunOptions {
  let values: {
    'dry-run': boolean
    'sample-inbox': boolean
    'print-corpus': boolean
    date?: string
  }
  try {
    ;({ values } = parseNodeArgs({
      args: [...argv],
      options: {
        'dry-run': { type: 'boolean', default: false },
        'sample-inbox': { type: 'boolean', default: false },
        'print-corpus': { type: 'boolean', default: false },
        date: { type: 'string' },
      },
      strict: true,
      // This CLI takes no positionals, so allowing them can only ever swallow
      // something meant to be honored: `--` is an end-of-options terminator, and
      // with a positionals bucket to land in, every flag after it was silently
      // discarded and the run proceeded at its defaults (#17).
      allowPositionals: false,
    }))
  } catch (err) {
    // Node names the offending flag, not the `--` that demoted it — so say where a
    // `--` comes from, since nobody types one deliberately here.
    const hint = argv.includes('--')
      ? '\nNote: pnpm forwards a literal `--` to the script — run `pnpm start --dry-run`, without the `--`.'
      : ''
    throw new Error(`${errMessage(err)}\n${USAGE}${hint}`)
  }

  const sampleInbox = values['sample-inbox']
  const date = values.date

  // The sample is a fixed label with no relation to any date; honoring both would
  // mean silently ignoring one of them.
  if (date !== undefined && sampleInbox)
    throw new Error('--date and --sample-inbox are mutually exclusive.')

  return {
    dryRun: values['dry-run'],
    sampleInbox,
    printCorpus: values['print-corpus'],
    briefDate: date === undefined ? null : parseIsoDate(date, now),
  }
}

/**
 * The daily run: fetch → parse → corpus → compose → send → persist. Nothing is
 * written until after a successful send, so a failed run leaves no partial state.
 *
 * `--dry-run` stops after compose and prints the brief instead of sending or
 * persisting — the single knob for exercising the pipeline. It reads history and
 * reuses cleanup like production, so it is not a pure/repeatable run; deterministic
 * model checks belong to the eval harnesses, not here.
 *
 * `--date` rebuilds one past day instead: newsletters only, scoped to that day's
 * mail. It is a recovery path for a run that never happened, not an off-cycle send —
 * the output is the brief that day should have produced.
 */
async function run({
  dryRun,
  sampleInbox,
  printCorpus,
  briefDate: requestedDate,
}: RunOptions) {
  const backfill = requestedDate !== null
  const briefDate = requestedDate ?? resolveBriefDate(new Date())
  const window = backfill ? dayWindow(briefDate) : undefined

  if (dryRun)
    console.log('DRY RUN — pipeline only; nothing sent or persisted.\n')
  if (sampleInbox)
    console.log(
      `SAMPLE INBOX — newsletters from the fixed ${SAMPLE_INBOX_QUERY} sample.\n`
    )
  if (window)
    console.log(
      `BACKFILL ${formatBriefDate(briefDate)} — newsletters only, ` +
        `${window.start.toISOString()} → ${window.end.toISOString()}.\n`
    )

  // Recipient/sender come only from env; refuse to run without them so a brief can
  // never be addressed to a guessed or empty target. Only needed for a real send.
  const sender = dryRun ? '' : requireEnv('BRIEF_SENDER')
  const recipient = dryRun ? '' : requireEnv('BRIEF_RECIPIENT')

  // Refuse to brief a day that already has one. Only for a backfill: the scheduled
  // path stays re-runnable (nothing is written until after a successful send, so a
  // retry is a normal recovery). Without this, re-running a finished date would find
  // an empty inbox — its mail is archived — and quietly send a "No news today!".
  if (backfill && !dryRun) {
    const existing = await prisma.brief.findFirst({
      where: { briefDate },
      select: { id: true },
    })
    if (existing)
      throw new Error(
        `A brief already exists for ${formatBriefDate(briefDate)} (id ${existing.id}). ` +
          `Its mail is already archived, so a re-run would find nothing.`
      )
  }

  // A dry run never writes, so instructions resolve to the code default in memory
  // rather than self-healing into a persisted Instructions row.
  const [cleanupInstructions, composeInstructions] = await Promise.all([
    resolveInstructions('NEWSLETTER_CLEANUP', !dryRun),
    resolveInstructions('COMPOSE', !dryRun),
  ])

  const docs = await gather({ sampleInbox, cleanupInstructions, window })
  const corpus = buildCorpus(docs)
  if (printCorpus) {
    console.log('\n===== corpus =====')
    console.log(corpus)
    console.log('===== end corpus =====\n')
  }

  // An empty day is a legitimate outcome for the scheduled run — "no news today" is
  // worth saying — but for a specific past date it almost always means the date was
  // wrong or its mail is already archived. Report that instead of mailing a blank
  // brief, and leave nothing behind.
  if (backfill && docs.length === 0) {
    console.log(
      `No newsletters in the window for ${formatBriefDate(briefDate)} — nothing to brief. ` +
        `Check the date, or whether that day already ran.`
    )
    return
  }

  // Dedup context is the briefs that preceded this one *by the day it covers*, not
  // the newest rows — a backfill must not be handed briefs from its own future.
  // `lte` rather than `lt` so a same-day re-run still sees the earlier attempt.
  const recent = await prisma.brief.findMany({
    where: { briefDate: { lte: briefDate } },
    orderBy: [{ briefDate: 'desc' }, { id: 'desc' }],
    take: RECENT_BRIEFS,
    select: { body: true },
  })
  const { body, composeCall } = await composeBody(
    docs,
    corpus,
    composeInstructions,
    recent.map((b) => stripProvenance(b.body))
  )

  const subject = briefSubject(briefDate)

  if (dryRun) {
    console.log('\n===== brief =====')
    console.log(`Subject: ${subject}\n`)
    console.log(body)
    console.log('===== end brief — nothing sent or persisted =====')
    return
  }

  // Send before recording: a send failure leaves nothing persisted, so the next
  // run simply rebuilds and re-sends rather than losing state. The Markdown body is
  // rendered to HTML for the email only; the stored `body` (below) stays Markdown.
  const { id } = await sendEmail({
    // Quote the display name so its apostrophe can't confuse header parsing.
    from: `"${SENDER_NAME}" <${sender}>`,
    to: recipient,
    subject,
    text: body,
    html: renderBriefHtml(body),
  })
  console.log(`Sent "${subject}" to ${recipient} (message ${id}).`)

  const brief = await persist({
    sender,
    recipient,
    subject,
    body,
    corpus,
    briefDate,
    docs,
    composeCall,
  })
  console.log(
    `Recorded brief ${brief.id} with ${docs.length} source document(s).`
  )

  // Archive the newsletters this brief was built from: label them PROCESSED and
  // drop them out of the inbox so the next run's `in:inbox` search skips them.
  // Only the emails that made the corpus (parsed and persisted) — a parse failure
  // leaves its email in the inbox to retry. Skipped for the fixed sample-inbox set
  // so its `label:TEST` messages stay reusable. Best-effort: the brief is already
  // sent and recorded, so a labeling hiccup is logged, not fatal (the email stays
  // in the inbox and is harmlessly re-seen next run).
  if (!sampleInbox) {
    const newsletterIds = newsletterMessageIds(docs)
    try {
      await markProcessed(newsletterIds)
      if (newsletterIds.length)
        console.log(
          `Labeled ${newsletterIds.length} newsletter(s) ${PROCESSED_LABEL} and archived.`
        )
    } catch (err) {
      console.log(
        `  ! failed to label/archive newsletters — ${errMessage(err)}`
      )
    }
  }
}

// Only run when invoked directly (`tsx src/index.ts …`), not when a test imports
// this module for `parseArgs`.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Sliced past the node and script paths: parseArgs takes flags only, and treats
  // anything that isn't one as an error rather than ignoring it.
  run(parseArgs(process.argv.slice(2)))
    .then(async () => {
      await prisma.$disconnect()
    })
    .catch(async (e) => {
      console.error(e)
      await prisma.$disconnect()
      process.exit(1)
    })
}
