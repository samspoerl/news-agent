# News Agent

A scheduled agent that ingests RSS feeds and newsletters once a day, triages what
actually matters, and emails a short awareness brief with links. It optimizes for
awareness over depth — headline-level items with a link to click through — and treats
"no news today" as a successful outcome, not an error.

See [PLAN.md](PLAN.md) for the design rationale and the invariants the pipeline has
to keep — read it before changing triage, compose, link handling, or the schedule.

## Stack

- **Runtime:** Node.js, run via `tsx` (no build step for a cron script)
- **Language:** TypeScript (strict, v7)
- **Database:** Neon Postgres via Prisma ORM
- **AI:** Vercel AI Gateway via the AI SDK (provider-agnostic, one credential). Two
  tasks: newsletter HTML→Markdown cleanup (cheap model) and single-pass brief
  compose (strong model). Prompts are versioned in the DB (`Instructions`). Compose
  retries on `COMPOSE_FALLBACK_MODEL` (a different provider) when the primary
  returns no usable brief, and fails the run rather than sending an empty one —
  provider safety filters fire on ordinary security news, and a filtered response
  arrives as a clean, empty one that reads exactly like a quiet news day.
- **RSS ingestion:** `rss-parser` → rendered to Markdown deterministically
- **Newsletter HTML→Markdown:** `turndown` (with a pre-strip) then model cleanup
- **Brief Markdown→HTML:** `marked` renders the composed Markdown to the email's HTML part (the DB keeps Markdown)
- **Newsletter ingestion + delivery:** Gmail API (OAuth scope `gmail.modify` — covers read, label, and send); briefs sent as `multipart/alternative` (HTML + Markdown text fallback)
- **Testing:** Three layers — unit tests (Vitest) for pure/deterministic logic; AI
  evals for tuning models, reasoning, and prompts on versioned inputs; and a full
  pipeline run via `--dry-run` (fetch → parse → compose, nothing sent or persisted)
- **Authentication:** None
- **UI:** None
- **Schedule/deployment:** GitHub Actions — a daily cron for the run itself (also
  runnable locally), CI on every PR, and `prisma migrate deploy` on merge to main

## Project Structure

```
prisma/
  schema.prisma            # Prisma schema — Source, SourceDocument, Brief, AiCall, Instructions
  seed.ts                  # Seeds RSS sources + the default Instructions per AI task
prisma.config.ts           # Prisma config — schema path, migrations, seed command
src/
  index.ts                 # Entry point — the daily run (fetch → parse → compose → send → persist)
  prisma.ts                # Prisma client singleton (Neon or pg adapter)
  ingest/
    rss.ts                 # Fetch active feeds → raw XML + parsed entries (no DB writes)
    newsletters.ts         # Fetch recent inbox mail → raw HTML per email (no DB writes)
  parse/
    rss.ts                 # Render a feed's entries to Markdown (deterministic, no model)
    newsletter.ts          # HTML → strip → Turndown → model cleanup → clean Markdown
  brief/
    corpus.ts              # Assemble source documents into the single Markdown corpus
    html.ts                # Render the Markdown brief to HTML for the email (marked)
    links.ts               # Link fidelity: tokenize/restore URLs; drop unverifiable links
    provenance.ts          # "Composed from N RSS feeds and M newsletters." line (counted in code)
  ai/
    compose.ts             # Single-pass corpus → Markdown brief (triage + cluster + write); tokenizes corpus URLs; fallback model + empty-brief guard
    instructions.ts        # Code-default prompts, seeded as the first Instructions version
    types.ts               # Shared AI types (AiCallData, InstructionSet, Reasoning)
    utils.ts               # toPlainText (HTML/entity cleanup for RSS deks)
  gmail/                    # Gmail OAuth client, read (list/get messages), send, labels (mark processed + archive)
  util/concurrency.ts      # Bounded-parallel map (newsletter cleanup fan-out)
  util/day.ts              # Brief days: 05:00 UTC boundary, mail window, --date parsing
  generated/prisma/        # Generated Prisma client (gitignored)
scripts/
  summarize-corpus.ts      # Compose eval harness: corpus file → brief (pnpm eval:compose)
  instructions.ts          # Read/version the DB prompts (pnpm instructions:get / instructions:set)
  get-gmail-refresh-token.ts, check-gmail-token.ts, format-changes.ts
test/                      # Vitest unit tests for the deterministic pipeline
.github/workflows/
  ci.yml                   # PR + main: prettier (pushes fixes), tsc --noEmit, Vitest
  cd.yml                   # main: prisma migrate deploy against Neon
  daily-brief.yml          # The scheduled run itself (cron + manual backfill)
.env.example               # Expected environment variables
```

## Running It Locally

```
pnpm start                     # the real thing — sends mail, archives newsletters, writes rows
pnpm start:dry                 # fetch → parse → compose, then print the brief; nothing sent or persisted
pnpm eval:compose <file.md>    # just the compose stage over a saved corpus
```

Flags on `src/index.ts` (`pnpm start --dry-run`, no `--` separator — see
[Backfilling](#backfilling-a-missed-day) for why):

- `--dry-run` — stop after compose and print the brief instead of sending or
  persisting. Still reads history and reuses prior cleanup like a real run.
- `--sample-inbox` — read a fixed `label:TEST` newsletter sample instead of the live
  inbox, for a run that doesn't depend on what arrived today. The sample isn't
  archived afterward, so it stays reusable. Mutually exclusive with `--date`.
- `--print-corpus` — dump the composer's exact input.
- `--date YYYY-MM-DD` — rebuild one past day; see below.

Flag parsing is strict: an unknown flag, a bare argument, or a `--date` without a
value aborts the run rather than silently sending the wrong brief.

## Backfilling a Missed Day

If a scheduled run never happened, rebuild that day on demand:

```
pnpm start --date 2026-07-23             # send it
pnpm start --date 2026-07-23 --dry-run   # preview first
```

No `--` before the flags: pnpm forwards a literal `--` to the script, where it
terminates option parsing. The run now aborts rather than dropping the flags, but
the working form is the one above.

Also available as an optional `date` input on the workflow's manual trigger (blank =
a normal run for today). One day per invocation — run it once per missed day, oldest
first, so each day dedups against the one before it.

Things worth knowing before using it:

- **Newsletters only.** RSS feeds serve only what they hold right now, so a past day
  can't be recovered from them; a dated run skips RSS entirely.
- **A brief day runs 05:00 UTC → 05:00 UTC** (midnight EST, 01:00 EDT), so morning
  newsletters stay whole instead of splitting across two briefs. The boundary is a
  fixed offset, not DST-aware — same reasoning as the single fixed-hour cron.
- **Only unbriefed mail is reachable.** The query keeps `in:inbox`, and a successful
  run archives what it used, so a day that already went out will find nothing. That
  is deliberate — it's what makes a backfill safe to retry — and a duplicate-date
  guard reports it clearly rather than mailing an empty brief.
- **The daily and backfill windows don't tile.** The cron covers a rolling 25h back
  from whenever its 12:00 UTC run actually starts (an hour of slack, since Actions
  can start a scheduled run late); a brief day covers 05:00–05:00. Between the last successful run
  and the first backfilled day there's a sliver of mail no window claims. It stays in
  the inbox rather than being lost — backfill one extra day at the start to sweep it.
- **`Brief.briefDate` is the day covered; `sentAt` is when it actually went out.**
  They match for a scheduled run. Dedup context selects on `briefDate`, so a backfill
  reads the briefs that preceded its day rather than whatever is newest.

## AI Prompts

The two AI tasks — `NEWSLETTER_CLEANUP` and `COMPOSE` — run on prompts stored in the
`Instructions` table, versioned append-only: the newest version for a task wins at
runtime (see `resolveInstructions` in `src/index.ts`). Read and change them with the
`scripts/instructions.ts` helper — never hand-edit the table, and note there is no
in-place edit (rows are immutable, so an "update" is really a new version):

- Show the current prompt (or its full history) — do this before changing one:
  `pnpm instructions:get [compose|cleanup] [--history]`
- Change a prompt by appending a new version, from a file or `--stdin`; it becomes
  live for the next run:
  `pnpm instructions:set <compose|cleanup> --file <path> --note "why"`

Both read and write whichever database `DATABASE_URL` names, which locally is **dev**
(see [Environment](#environment)). A prompt set from a checkout changes dev only —
prod's `Instructions` rows live in the prod database and are reached from the scheduled
workflow, so tuning a prompt locally is free of production consequences.

The same prompts are also hardcoded in `src/ai/instructions.ts`
(`DEFAULT_INSTRUCTIONS`): that copy seeds a fresh DB (`prisma/seed.ts`), is the
fallback when a task has no DB version yet, and is what the compose eval harness
(`pnpm eval:compose`) runs against directly. When you change a prompt in the DB, also
update the matching default there (optional, but recommended) — the two need not stay
in lockstep, since a DB row is what a run actually uses, but keeping the code default
close means a re-seed, an eval, or a fresh checkout starts from something current
rather than stale.

## Environment

- **OS:** Windows 11
- **Shell:** PowerShell v7
- **Databases:** dev and prod are **separate Neon databases**. Local `.env` points at
  the dev one; prod is reached only through the GitHub Actions secrets
  (`DATABASE_URL` / `DIRECT_URL`) that `daily-brief.yml` and `cd.yml` inject. Nothing
  run from a local checkout — a migration, a seed, `instructions:set`, a live
  `pnpm start` — can touch prod data, so a local prompt version or a stray `Brief` row
  is never a production incident. Don't raise one as if it were.
- **Gmail is not split.** The same real mailbox backs both: a local `pnpm start` sends
  an actual email to `BRIEF_RECIPIENT` and archives the newsletters it consumed, which
  a later run can then no longer read. That, not the database, is what makes an
  unintended live run worth avoiding — prefer `pnpm start:dry`.

## Code Style

Always run prettier after making changes.

## Git Conventions

Use **Conventional Commits** (<https://www.conventionalcommits.org>) for all commits, branch names, and PR titles.

**Commit messages** - `<type>(<scope>): <description>`

- Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`
- Scope is optional but recommended (e.g., `rss`, `newsletter`, `triage`, `summarize`, `brief`, `gmail`, `ai`, `db`, `schedule`)
- Examples: `feat(rss): add Hacker News frontpage feed`, `fix(brief): omit empty sections`
- Use `BREAKING CHANGE:` footer and append `!` after the type/scope for breaking changes
- ALWAYS output commit messages in a code fence when asked for one

**Branch names** - `<type>/<issue-id>-<short-description>`

- Examples: `feat/12-rss-ingestion`, `fix/34-empty-brief-crash`, `chore/update-dependencies`

**PR titles** - same format as a commit subject: `<type>(<scope>): <description>`

- Examples: `refactor(triage): extract bucket classifier`, `docs(agents): fill in project structure`

## GitHub Issue Conventions

Issue titles use **Sentence case**, not Conventional Commits — labels carry type/domain/severity instead. Labels are filterable/groupable in the GitHub UI (issue list, Projects, milestones) in a way a title prefix isn't, and a title only ever describes one thing while an issue can span several domains. GitHub's native Issue Type field (Bug/Feature/Task) is intentionally unused — it's an org-only feature that doesn't exist on personal repos, so it can't be relied on for consistency across both.

- **Title:** plain sentence case, no prefix — e.g. `Deduplicate stories across consecutive briefs`
- **Labels:** apply exactly one type label, zero or more domain labels, and — for bugs — one `severity: *` label if the severity is known

**Type labels** — singular nouns naming what the issue _is_ (the PR that resolves it uses the verb form as its Conventional Commit type): `bug` (→ `fix`), `feature` (→ `feat`), `chore`, `documentation` (→ `docs`), `refactor`, `test`, `performance` (→ `perf`), `ci`

**Domain labels** — which part of the product the issue concerns, e.g. `rss`, `newsletter`, `triage`, `summarize`, `brief`, `gmail`, `ai`, `db`, `schedule`. Free-form and created as needed, same as commit scopes — apply as many as genuinely apply, since a single title prefix can't capture an issue that spans domains.

**Severity labels** (bugs only): `severity: critical`, `severity: high`, `severity: medium`, `severity: low`

When opening a PR for an issue, translate the issue's type and domain labels into the Conventional Commit PR title — e.g. an issue labeled `bug` + `brief` becomes PR title `fix(brief): ...`.

## Third-Party Documentation

- [AI SDK](https://ai-sdk.dev/llms.txt)
- [AI Gateway](https://vercel.com/docs/ai-gateway)
- [Prisma](https://www.prisma.io/docs)
- [rss-parser](https://github.com/rbren/rss-parser)
- [Gmail API](https://developers.google.com/gmail/api)
- [GitHub](https://docs.github.com/llms.txt)
