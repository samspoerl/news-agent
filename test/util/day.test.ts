import {
  DAY_BOUNDARY_UTC_HOUR,
  dayWindow,
  formatBriefDate,
  parseIsoDate,
  resolveBriefDate,
} from '@/util/day'
import { describe, expect, it } from 'vitest'

const iso = (d: Date) => d.toISOString()

describe('resolveBriefDate', () => {
  it('puts the 12:00 UTC cron on the current UTC date', () => {
    // The scheduled run must keep resolving exactly as it did before brief days
    // existed — anything else is a silent change to production.
    expect(iso(resolveBriefDate(new Date('2026-07-23T12:00:00Z')))).toBe(
      '2026-07-23T00:00:00.000Z'
    )
  })

  it('treats the boundary itself as the start of the new day', () => {
    const boundary = `2026-07-23T0${DAY_BOUNDARY_UTC_HOUR}:00:00Z`
    expect(iso(resolveBriefDate(new Date(boundary)))).toBe(
      '2026-07-23T00:00:00.000Z'
    )
  })

  it('counts the minute before the boundary as the previous day', () => {
    expect(iso(resolveBriefDate(new Date('2026-07-23T04:59:59Z')))).toBe(
      '2026-07-22T00:00:00.000Z'
    )
  })

  it('keeps a late Eastern evening on the day still in progress locally', () => {
    // 2026-07-23 21:00 EDT is already 2026-07-24 01:00 UTC, but it is still the
    // 23rd for a reader in New York — and still before the 05:00 boundary.
    expect(iso(resolveBriefDate(new Date('2026-07-24T01:00:00Z')))).toBe(
      '2026-07-23T00:00:00.000Z'
    )
  })

  it('rolls across month and year ends', () => {
    expect(iso(resolveBriefDate(new Date('2026-08-01T02:00:00Z')))).toBe(
      '2026-07-31T00:00:00.000Z'
    )
    expect(iso(resolveBriefDate(new Date('2027-01-01T03:00:00Z')))).toBe(
      '2026-12-31T00:00:00.000Z'
    )
  })
})

describe('dayWindow', () => {
  it('spans the boundary on the given day to the boundary on the next', () => {
    const { start, end } = dayWindow(new Date('2026-07-23T00:00:00Z'))
    expect(iso(start)).toBe('2026-07-23T05:00:00.000Z')
    expect(iso(end)).toBe('2026-07-24T05:00:00.000Z')
  })

  it('tiles consecutive days exactly — no gap, no overlap', () => {
    const first = dayWindow(new Date('2026-07-23T00:00:00Z'))
    const second = dayWindow(new Date('2026-07-24T00:00:00Z'))
    expect(iso(first.end)).toBe(iso(second.start))
  })

  it('agrees with resolveBriefDate: every instant lands in its own day window', () => {
    for (const at of [
      '2026-07-23T05:00:00Z',
      '2026-07-23T12:00:00Z',
      '2026-07-24T04:59:59Z',
    ]) {
      const instant = new Date(at)
      const { start, end } = dayWindow(resolveBriefDate(instant))
      expect(instant.getTime()).toBeGreaterThanOrEqual(start.getTime())
      expect(instant.getTime()).toBeLessThan(end.getTime())
    }
  })
})

describe('parseIsoDate', () => {
  const now = new Date('2026-07-25T12:00:00Z')

  it('parses a valid day to UTC midnight', () => {
    expect(iso(parseIsoDate('2026-07-23', now))).toBe(
      '2026-07-23T00:00:00.000Z'
    )
  })

  it('accepts today', () => {
    expect(iso(parseIsoDate('2026-07-25', now))).toBe(
      '2026-07-25T00:00:00.000Z'
    )
  })

  it('rejects a malformed date', () => {
    for (const bad of ['7/23/2026', '2026-7-23', 'yesterday', '', '2026-07']) {
      expect(() => parseIsoDate(bad, now)).toThrow(/YYYY-MM-DD/)
    }
  })

  it('rejects a day that does not exist', () => {
    // Date.UTC would silently roll these forward; the parser must not.
    expect(() => parseIsoDate('2026-02-30', now)).toThrow(
      /no such calendar day/
    )
    expect(() => parseIsoDate('2026-13-01', now)).toThrow(
      /no such calendar day/
    )
    expect(() => parseIsoDate('2026-00-10', now)).toThrow(
      /no such calendar day/
    )
  })

  it('rejects a future date', () => {
    expect(() => parseIsoDate('2026-07-26', now)).toThrow(/in the future/)
    expect(() => parseIsoDate('2027-01-01', now)).toThrow(/in the future/)
  })
})

describe('formatBriefDate', () => {
  it('renders the brief day, not a timezone-shifted neighbor', () => {
    // A brief day is UTC midnight; formatting it in any negative-offset local
    // timezone without forcing UTC would print the day before.
    expect(formatBriefDate(new Date('2026-07-23T00:00:00Z'))).toBe(
      'Jul 23, 2026'
    )
    expect(formatBriefDate(new Date('2026-01-01T00:00:00Z'))).toBe(
      'Jan 1, 2026'
    )
  })
})
