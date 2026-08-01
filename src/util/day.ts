/**
 * The day a brief belongs to, and the mail window that fills it.
 *
 * A "brief day" is a calendar day whose boundary sits at 05:00 UTC — midnight
 * Eastern Standard Time. Newsletters land in the morning, so a boundary here keeps
 * a day's mail intact instead of splitting the morning batch across two briefs.
 *
 * The offset is fixed rather than DST-aware, matching the scheduling choice made
 * when the DST-aware dual cron was dropped for a single 12:00 UTC run: under
 * daylight time the boundary drifts to 01:00 EDT. That drift is harmless — it moves
 * the seam through the quietest hours — and it buys arithmetic that needs no
 * timezone database.
 *
 * A brief day is represented as a `Date` at UTC midnight of that calendar day, so
 * it round-trips cleanly through Postgres `DATE` and compares by value.
 */

export const DAY_BOUNDARY_UTC_HOUR = 5

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** UTC midnight of the calendar day `date` falls in. */
function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

/**
 * The brief day containing `now`: shift back past the 05:00 UTC boundary, then take
 * the UTC calendar date. The 12:00 UTC cron lands on the current UTC date either
 * way, so the scheduled run is unaffected; a local run before 05:00 UTC (evening
 * Eastern) correctly resolves to the day that is still in progress locally.
 */
export function resolveBriefDate(now: Date): Date {
  return utcMidnight(new Date(now.getTime() - DAY_BOUNDARY_UTC_HOUR * HOUR_MS))
}

/**
 * The half-open mail window `[start, end)` for a brief day — 05:00 UTC on that day
 * through 05:00 UTC the next. Half-open so consecutive days tile exactly: no email
 * can fall in two windows, and none can fall between them.
 */
export function dayWindow(briefDate: Date): { start: Date; end: Date } {
  const start = new Date(briefDate.getTime() + DAY_BOUNDARY_UTC_HOUR * HOUR_MS)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

/**
 * Parse a `YYYY-MM-DD` brief day, rejecting anything that isn't a real past or
 * present day. Strict on purpose: this is the one place a mistyped date could
 * otherwise turn into a silently wrong (or empty) brief.
 *
 * `now` is injectable so the future check is testable without faking the clock.
 */
export function parseIsoDate(value: string, now = new Date()): Date {
  const match = ISO_DATE.exec(value)
  if (!match)
    throw new Error(
      `Invalid date "${value}" — expected YYYY-MM-DD (e.g. 2026-07-23).`
    )

  const [, year, month, day] = match
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  )

  // Date.UTC rolls overflow forward (Feb 30 → Mar 2), so confirm the parts survived.
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  )
    throw new Error(`Invalid date "${value}" — no such calendar day.`)

  if (parsed.getTime() > resolveBriefDate(now).getTime())
    throw new Error(
      `Invalid date "${value}" — it is in the future; there is no mail to backfill.`
    )

  return parsed
}

/**
 * Render a brief day for the email subject: "Jul 23, 2026". Forced to UTC — a brief
 * day is a UTC-midnight Date, so formatting it in a negative-offset local timezone
 * (Eastern included) would render the previous day.
 */
export function formatBriefDate(briefDate: Date): string {
  return briefDate.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
