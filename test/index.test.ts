import { newsletterMessageIds, parseArgs } from '@/index'
import type { RunDocument } from '@/brief/corpus'
import { describe, expect, it } from 'vitest'

// A minimal RunDocument for id-selection tests — only the fields the filter reads.
function doc(over: Partial<RunDocument>): RunDocument {
  return {
    sourceType: 'NEWSLETTER',
    sourceId: null,
    sourceName: 'Sender',
    sourceIdentifier: 'sender@x.com',
    raw: '',
    markdown: '',
    cleanup: null,
    gmailMessageId: null,
    feedBuildDate: null,
    ...over,
  }
}

// A fixed "now" so the future-date check in --date parsing doesn't drift.
const NOW = new Date('2026-07-25T12:00:00Z')

describe('parseArgs', () => {
  it('defaults every flag to false with no args', () => {
    // argv arrives sliced past the node + script paths; parseArgs sees flags only.
    expect(parseArgs([])).toEqual({
      dryRun: false,
      sampleInbox: false,
      printCorpus: false,
      briefDate: null,
    })
  })

  it('sets a flag when its switch is present', () => {
    expect(parseArgs(['--dry-run'])).toMatchObject({
      dryRun: true,
      sampleInbox: false,
      printCorpus: false,
    })
    expect(parseArgs(['--sample-inbox'])).toMatchObject({
      sampleInbox: true,
    })
    expect(parseArgs(['--print-corpus'])).toMatchObject({
      printCorpus: true,
    })
  })

  it('resolves flags independently and in any order', () => {
    expect(parseArgs(['--print-corpus', '--dry-run'])).toEqual({
      dryRun: true,
      sampleInbox: false,
      printCorpus: true,
      briefDate: null,
    })
    expect(
      parseArgs(['--sample-inbox', '--dry-run', '--print-corpus'])
    ).toEqual({
      dryRun: true,
      sampleInbox: true,
      printCorpus: true,
      briefDate: null,
    })
  })

  it('rejects unknown flags', () => {
    // Strict on purpose: a typo like `--dry-runn` would otherwise be discarded and
    // the run would send a real brief instead of previewing one.
    expect(() => parseArgs(['--isolated'])).toThrow(/Unknown option/)
    expect(() => parseArgs(['--dry-runn'])).toThrow(/Unknown option/)
  })

  it('rejects a `--` terminator instead of dropping what follows it', () => {
    // `pnpm start -- --dry-run` forwards the literal `--`, which ends option
    // parsing. Everything after it used to be discarded silently, so the preview
    // sent a real brief and `--date` never reached a backfill (#17).
    expect(() => parseArgs(['--', '--dry-run', '--print-corpus'])).toThrow(
      /Unexpected argument/
    )
    expect(() => parseArgs(['--', '--date', '2026-07-23'], NOW)).toThrow(
      /Unexpected argument/
    )
    // The error names the flag, so the hint has to name the `--`.
    expect(() => parseArgs(['--', '--dry-run'])).toThrow(/without the `--`/)
  })

  it('rejects anything that is not a flag', () => {
    expect(() => parseArgs(['2026-07-23'])).toThrow(/Unexpected argument/)
    // Slicing off the node + script paths is the caller's job, not parseArgs's.
    expect(() => parseArgs(['node', 'index.ts', '--dry-run'])).toThrow(
      /Unexpected argument/
    )
  })

  it('reports usage when parsing fails', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/--date YYYY-MM-DD/)
  })

  it('reads --date in both spellings', () => {
    const expected = new Date('2026-07-23T00:00:00Z')
    expect(parseArgs(['--date', '2026-07-23'], NOW).briefDate).toEqual(expected)
    expect(parseArgs(['--date=2026-07-23'], NOW).briefDate).toEqual(expected)
  })

  it('combines --date with the boolean flags', () => {
    expect(
      parseArgs(['--date', '2026-07-23', '--dry-run', '--print-corpus'], NOW)
    ).toEqual({
      dryRun: true,
      sampleInbox: false,
      printCorpus: true,
      briefDate: new Date('2026-07-23T00:00:00Z'),
    })
  })

  it('throws when --date has no usable value', () => {
    expect(() => parseArgs(['--date'], NOW)).toThrow(/argument missing/)
    // `--date --dry-run` must not bind the flag as the date — that would drop the
    // dry run and send for real.
    expect(() => parseArgs(['--date', '--dry-run'], NOW)).toThrow(/ambiguous/)
    // An empty inline value parses to "", which then fails date validation.
    expect(() => parseArgs(['--date='], NOW)).toThrow(/YYYY-MM-DD/)
  })

  it('throws on a date it cannot trust', () => {
    // A mistyped date must never fall through to a live send for today.
    expect(() => parseArgs(['--date', '7/23/2026'], NOW)).toThrow(/YYYY-MM-DD/)
    expect(() => parseArgs(['--date', '2026-02-30'], NOW)).toThrow(
      /no such calendar day/
    )
    expect(() => parseArgs(['--date', '2026-07-26'], NOW)).toThrow(
      /in the future/
    )
  })

  it('rejects --date together with --sample-inbox', () => {
    expect(() =>
      parseArgs(['--date', '2026-07-23', '--sample-inbox'], NOW)
    ).toThrow(/mutually exclusive/)
  })
})

describe('newsletterMessageIds', () => {
  it('returns only newsletter docs that carry a Gmail id', () => {
    const docs = [
      doc({ gmailMessageId: 'a' }),
      doc({ sourceType: 'RSS', sourceId: 1, gmailMessageId: null }),
      doc({ gmailMessageId: null }), // newsletter without an id (shouldn't happen)
      doc({ gmailMessageId: 'b' }),
    ]
    expect(newsletterMessageIds(docs)).toEqual(['a', 'b'])
  })

  it('is empty when no newsletters made the corpus', () => {
    expect(newsletterMessageIds([])).toEqual([])
    expect(
      newsletterMessageIds([doc({ sourceType: 'RSS', sourceId: 1 })])
    ).toEqual([])
  })
})
