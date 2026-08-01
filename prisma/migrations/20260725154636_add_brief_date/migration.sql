-- Adds `briefs.brief_date`: the day a brief covers, as distinct from `sent_at`,
-- which is when it was actually delivered. They match for a scheduled run and
-- diverge for a backfill (`--date`), which rebuilds a missed day after the fact.
--
-- Added nullable, backfilled, then tightened to NOT NULL so existing rows survive.
-- Deriving the backfill from `sent_at` is exact for every pre-existing row: all of
-- them were same-day cron runs at 12:00 UTC, which is past the 05:00 UTC brief-day
-- boundary, so the UTC calendar date of `sent_at` is the day each one covered.

-- AlterTable
ALTER TABLE "briefs" ADD COLUMN     "brief_date" DATE;

UPDATE "briefs" SET "brief_date" = ("sent_at" AT TIME ZONE 'UTC')::date;

ALTER TABLE "briefs" ALTER COLUMN "brief_date" SET NOT NULL;

-- CreateIndex
CREATE INDEX "briefs_brief_date_idx" ON "briefs"("brief_date");
