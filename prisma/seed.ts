import 'dotenv/config'
import { DEFAULT_INSTRUCTIONS } from '@/ai/instructions'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const url = process.env.DATABASE_URL!
const adapter =
  process.env.DATABASE_ADAPTER === 'pg'
    ? new PrismaPg({ connectionString: url })
    : new PrismaNeon({ connectionString: url })
const prisma = new PrismaClient({ adapter })

// Tech-news bucket RSS feeds. Idempotent: keyed on the unique [type, identifier],
// so re-running updates the name without creating duplicates. Add feeds here; to
// drop one from the pipeline set `active: false` in the DB (re-seeding won't
// re-enable it) or delete the row.
//
// Newsletter sources aren't seeded: intake is allow-by-default, so senders are
// auto-registered as they arrive (see src/ingest/newsletters.ts). Mute one by
// setting its Source `active: false`.
const rssFeeds: { name: string; identifier: string }[] = [
  {
    name: 'Hacker News (front page)',
    identifier: 'https://hnrss.org/frontpage',
  },
  {
    name: 'Ars Technica',
    identifier: 'https://feeds.arstechnica.com/arstechnica/index',
  },
  { name: 'The Verge', identifier: 'https://www.theverge.com/rss/index.xml' },
  {
    name: 'Simon Willison',
    identifier: 'https://simonwillison.net/atom/everything/',
  },
  { name: 'TechCrunch', identifier: 'https://techcrunch.com/feed/' },
]

async function main() {
  for (const feed of rssFeeds) {
    const source = await prisma.source.upsert({
      where: { type_identifier: { type: 'RSS', identifier: feed.identifier } },
      create: { type: 'RSS', name: feed.name, identifier: feed.identifier },
      update: { name: feed.name },
    })
    console.log(`✓ ${source.name} — ${source.identifier}`)
  }
  const rssCount = await prisma.source.count({ where: { type: 'RSS' } })
  console.log(`\n${rssCount} RSS source(s) in the database.`)

  // Seed the first prompt version for each AI task. Idempotent: only inserts when
  // a task has no versions yet. New versions are added by inserting new rows (the
  // app reads the latest), so re-seeding never clobbers a hand-tuned prompt.
  for (const task of ['COMPOSE', 'NEWSLETTER_CLEANUP'] as const) {
    const existing = await prisma.instructions.count({ where: { task } })
    if (existing === 0) {
      await prisma.instructions.create({
        data: { task, body: DEFAULT_INSTRUCTIONS[task], note: 'seed default' },
      })
      console.log(`✓ ${task} instructions seeded`)
    } else {
      console.log(
        `· ${task} instructions already present (${existing} version(s))`
      )
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
