import 'dotenv/config'
import { DEFAULT_INSTRUCTIONS, type AiTaskName } from '@/ai/instructions'
import prisma from '@/prisma'
import { readFileSync } from 'node:fs'

/**
 * Read and version the AI task prompts stored in the `Instructions` table.
 *
 * Instruction rows are IMMUTABLE and append-only: the daily run reads the latest
 * version per task (`orderBy [createdAt desc, id desc] take 1`, see
 * src/index.ts:resolveInstructions), so "updating" a prompt is really inserting a
 * new row. `get` shows the current prompt (or its history); `set` appends a new
 * version, which becomes live for the next run.
 *
 *   # read
 *   pnpm instructions:get                     # both tasks, current version
 *   pnpm instructions:get compose             # one task's current body
 *   pnpm instructions:get cleanup --history   # all versions, newest first
 *
 *   # write a new version (body comes from a file, or stdin)
 *   pnpm instructions:set compose --file new-compose.md --note "add DC news section"
 *   cat new-compose.md | pnpm instructions:set compose --stdin --note "…"
 *
 * Task names are fuzzy: compose | cleanup | newsletter | newsletter-cleanup (and
 * the raw enum COMPOSE | NEWSLETTER_CLEANUP). Needs DATABASE_URL in the env (.env).
 */

// Friendly aliases → the AiTask enum value. Keeps the CLI forgiving so a request
// like "the newsletter cleanup instructions" maps without memorizing the enum.
const TASK_ALIASES: Record<string, AiTaskName> = {
  compose: 'COMPOSE',
  cleanup: 'NEWSLETTER_CLEANUP',
  newsletter: 'NEWSLETTER_CLEANUP',
  'newsletter-cleanup': 'NEWSLETTER_CLEANUP',
  newsletter_cleanup: 'NEWSLETTER_CLEANUP',
}
const ALL_TASKS: AiTaskName[] = ['COMPOSE', 'NEWSLETTER_CLEANUP']

function resolveTask(input: string): AiTaskName {
  const key = input.trim().toLowerCase()
  const task = TASK_ALIASES[key]
  if (!task) {
    fail(
      `Unknown task "${input}". Use one of: compose, cleanup ` +
        `(aliases: newsletter, newsletter-cleanup).`
    )
  }
  return task
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Pull `--name value` (or `--name=value`) out of argv; returns undefined if absent. */
function takeOption(args: string[], name: string): string | undefined {
  const flag = `--${name}`
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`))
  if (i === -1) return undefined
  const inline = args[i].includes('=') ? args[i].split(/=(.*)/s)[1] : undefined
  if (inline !== undefined) {
    args.splice(i, 1)
    return inline
  }
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) {
    fail(`${flag} needs a value.`)
  }
  args.splice(i, 2)
  return value
}

/** Pull a boolean `--name` flag out of argv; returns true if it was present. */
function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** The latest version for a task, or null when the task has no rows yet. */
async function currentVersion(task: AiTaskName) {
  return prisma.instructions.findFirst({
    where: { task },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

async function printCurrent(task: AiTaskName): Promise<void> {
  const row = await currentVersion(task)
  console.log(`\n=== ${task} — current version ===`)
  if (!row) {
    console.log(
      `(no versions in the DB — the run would fall back to the code default in ` +
        `src/ai/instructions.ts, ${DEFAULT_INSTRUCTIONS[task].length} chars)\n`
    )
    console.log(DEFAULT_INSTRUCTIONS[task])
    return
  }
  console.log(`  version id: #${row.id}`)
  console.log(`  created:    ${row.createdAt.toISOString()}`)
  console.log(`  note:       ${row.note ?? '(none)'}`)
  console.log(`  length:     ${row.body.length.toLocaleString()} chars\n`)
  console.log(row.body)
}

async function printHistory(task: AiTaskName): Promise<void> {
  const rows = await prisma.instructions.findMany({
    where: { task },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  console.log(`\n=== ${task} — ${rows.length} version(s), newest first ===`)
  if (rows.length === 0) {
    console.log('  (none — falls back to the code default)')
    return
  }
  rows.forEach((row, i) => {
    const current = i === 0 ? '  ← current' : ''
    const len = `${row.body.length.toLocaleString()} chars`.padStart(12)
    console.log(
      `  #${String(row.id).padEnd(4)} ${row.createdAt.toISOString()}  ${len}  ` +
        `${row.note ?? '(no note)'}${current}`
    )
  })
}

async function runGet(args: string[]): Promise<void> {
  const history = takeFlag(args, 'history')
  const taskArg = args.find((a) => !a.startsWith('--'))
  const tasks = taskArg ? [resolveTask(taskArg)] : ALL_TASKS
  for (const task of tasks) {
    if (history) await printHistory(task)
    else await printCurrent(task)
  }
}

async function runSet(args: string[]): Promise<void> {
  const file = takeOption(args, 'file')
  const note = takeOption(args, 'note')
  const useStdin = takeFlag(args, 'stdin')
  const taskArg = args.find((a) => !a.startsWith('--'))
  if (!taskArg)
    fail('Which task? e.g. `instructions:set compose --file body.md`')
  const task = resolveTask(taskArg)

  if (!!file === useStdin) {
    fail('Provide the new body via exactly one of --file <path> or --stdin.')
  }
  const raw = file ? readFileSync(file, 'utf8') : await readStdin()
  const body = raw.replace(/\s+$/, '')
  if (!body) fail('Refusing to store an empty instructions body.')

  const previous = await currentVersion(task)
  const created = await prisma.instructions.create({
    data: { task, body, note: note ?? null },
  })

  const prevLen = previous?.body.length ?? 0
  const delta = created.body.length - prevLen
  const sign = delta >= 0 ? '+' : ''
  console.log(`\n✓ ${task} instructions updated`)
  console.log(
    `  new version:  #${created.id}` +
      (previous ? ` (previously #${previous.id})` : ' (first version)')
  )
  console.log(
    `  length:       ${created.body.length.toLocaleString()} chars` +
      (previous ? ` (was ${prevLen.toLocaleString()}; ${sign}${delta})` : '')
  )
  console.log(
    `  note:         ${created.note ?? '(none — consider adding --note)'}`
  )
  console.log('\nThis is now the live prompt for the next run.')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args.shift()
  switch (command) {
    case 'get':
      await runGet(args)
      break
    case 'set':
      await runSet(args)
      break
    default:
      fail(
        `Unknown command "${command ?? ''}". Usage:\n` +
          `  instructions get [task] [--history]\n` +
          `  instructions set <task> (--file <path> | --stdin) [--note "…"]`
      )
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
