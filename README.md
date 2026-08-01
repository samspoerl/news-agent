# News Agent

A scheduled agent that reads your RSS feeds and email newsletters once a day, decides
what actually matters, and emails you a short awareness brief with links. It optimizes
for awareness over depth — headline-level items you can click through — and treats "no
news today" as a success, not a failure.

It runs as a GitHub Actions cron job (or on your own machine), stores what it has seen
in Postgres so it doesn't repeat itself, and uses one AI call to clean up each
newsletter and one to write the brief.

See [PLAN.md](PLAN.md) for the design rationale and [AGENTS.md](AGENTS.md) for the
project structure and conventions.

## Requirements

- Node 24+ and pnpm
- A Postgres database (Neon by default)
- A Vercel AI Gateway key, or any single model provider's API key
- A Gmail account for the agent to send from and receive newsletters in

Setup is four things: a database, an AI key, a Gmail account with OAuth credentials,
and a `.env` holding all of it.

```sh
pnpm install
cp .env.example .env   # fill this in as you go through the steps below
```

## 1. Database

The agent keeps sources, ingested documents, past briefs, and its prompts in Postgres.

**Neon (default).** Create a project at [neon.tech](https://neon.tech), then copy both
connection strings into `.env`:

```ini
DATABASE_URL="postgresql://…-pooler.…/neondb?sslmode=require"   # pooled — used at runtime
DIRECT_URL="postgresql://….neon.tech/neondb?sslmode=require"    # direct — used for migrations
```

**Any other Postgres** (local Docker, RDS, Supabase…) works too — set both variables to
the same connection string and switch the driver:

```ini
DATABASE_ADAPTER="pg"
```

Then create the schema and seed it:

```sh
pnpm db:generate                  # generate the Prisma client (gitignored, always needed)
pnpm exec prisma migrate deploy   # create the tables
pnpm db:seed                      # a starter set of RSS feeds + the default prompts
```

Feeds live in the `Source` table — edit [prisma/seed.ts](prisma/seed.ts) and re-seed to
add your own, or set `active: false` on a row to mute one. Newsletter senders don't need
seeding: they're registered automatically the first time they show up.

## 2. AI access

By default the agent names models as plain `provider/model` strings and routes them
through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), so one credential
covers every provider. Create a key in the Vercel dashboard (AI Gateway → API Keys):

```ini
AI_GATEWAY_API_KEY="vck_…"
```

Model choice is optional — the defaults are a strong model for the brief and a cheap one
for newsletter cleanup. To override:

```ini
COMPOSE_MODEL="anthropic/claude-sonnet-5"
COMPOSE_FALLBACK_MODEL="openai/gpt-5.6-luna"   # retried when the primary returns nothing
COMPOSE_REASONING="high"
NEWSLETTER_CLEANUP_MODEL="openai/gpt-5.6-luna"
NEWSLETTER_CLEANUP_REASONING="low"
```

> Recommended: set `COMPOSE_FALLBACK_MODEL` to a _different provider_ than `COMPOSE_MODEL`. Set the two equal for a single attempt and no retry.

### Using one provider directly instead

If you'd rather not use the Gateway, install that provider's adapter, set its key, and
wrap the model ids where they're passed to `generateText`:

```sh
pnpm add @ai-sdk/anthropic   # or @ai-sdk/openai, @ai-sdk/google, …
```

```ini
ANTHROPIC_API_KEY="sk-ant-…"
```

```ts
// src/ai/compose.ts and src/parse/newsletter.ts
import { anthropic } from '@ai-sdk/anthropic'
// model: COMPOSE_MODEL  →
model: anthropic(COMPOSE_MODEL)
```

Model ids then drop the `provider/` prefix (`claude-sonnet-5`), and the compose fallback
loses its point unless you wire a second provider in alongside — so point both compose
variables at the same model.

## 3. Gmail

The agent needs a mailbox of its own. It reads the newsletters that arrive there,
archives the ones it used, and sends the finished brief to you.

**Create the account.** Make a new Gmail account (e.g. `yournewsagent@gmail.com`) and
subscribe it to the newsletters you want in the brief. Using a dedicated account keeps
the agent away from your personal mail — it can only ever see what you point at it.

**Create an OAuth client.** In the [Google Cloud Console](https://console.cloud.google.com):

1. Create a project (it can live under any Google account — it doesn't have to be the
   agent's).
2. **APIs & Services → Library →** enable the **Gmail API**.
3. **OAuth consent screen →** choose **External**, add the agent's address as a **Test
   user**, and then **publish the app to production**. Publishing is strongly
   recommended: while the app is in testing, Google expires its refresh tokens after
   **7 days**, so you'd have to re-run the token script every week to keep the daily
   run alive. Publishing is a one-click change with no review to wait for — Google
   will show an "unverified app" warning at sign-in, which is fine here, since the
   only person who ever sees that screen is you authorizing your own account.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the id
   and secret:

```ini
GMAIL_CLIENT_ID="….apps.googleusercontent.com"
GMAIL_CLIENT_SECRET="GOCSPX-…"
```

The one scope requested is `gmail.modify`, which covers reading, labeling, and sending.

**Get a refresh token.** With those two values in `.env`:

```sh
pnpm gmail:token
```

It prints a URL and waits on a loopback redirect. Open it, **sign in as the agent
account** (not your personal one), and approve. Google will warn that the app isn't
verified — expected for a client you made for yourself; click _Advanced → Go to …
(unsafe)_. Paste the printed token into `.env`:

```ini
GMAIL_REFRESH_TOKEN="1//…"
```

With the app published, this is a one-time step — the token lasts until you revoke
access or change the account password. If you left the app in testing, you'll be back
here every 7 days. Verify the token any time with `pnpm gmail:check`.

**Set the addresses.** `BRIEF_SENDER` must be the account you just authorized;
`BRIEF_RECIPIENT` is the only address a brief is ever sent to.

```ini
BRIEF_SENDER="yournewsagent@gmail.com"
BRIEF_RECIPIENT="you@example.com"
```

## 4. Run it

```sh
pnpm start:dry   # fetch → parse → compose, then print the brief; nothing sent or saved
pnpm start       # the real thing: emails the brief, archives newsletters, writes rows
```

Start with the dry run. A real run consumes mail — the newsletters it uses get archived,
so a later run can't read them again.

Useful flags (no `--` separator — `pnpm start --dry-run`):

| Flag                | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `--dry-run`         | Stop after composing; print the brief instead of sending it |
| `--print-corpus`    | Dump the exact text the composer was given                  |
| `--date YYYY-MM-DD` | Rebuild one past day (newsletters only — see below)         |
| `--sample-inbox`    | Read a fixed `label:TEST` sample instead of the live inbox  |

Unknown or malformed flags abort the run rather than silently sending the wrong brief.

**Backfilling.** If a day's run never happened, `pnpm start --date 2026-07-23` rebuilds
it from the newsletters still sitting in the inbox. RSS feeds only serve what they hold
right now, so a dated run skips them. Run one day per invocation, oldest first. See
[AGENTS.md](AGENTS.md#backfilling-a-missed-day) for more details.

## Scheduling it

[`.github/workflows/daily-brief.yml`](.github/workflows/daily-brief.yml) runs the agent
daily at 12:00 UTC and can also be triggered by hand (with an optional backfill date).
To use it, add your values to the repo:

- **Secrets:** `DATABASE_URL`, `DIRECT_URL`, `AI_GATEWAY_API_KEY`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REFRESH_TOKEN`
  - _Tip: use `gh secret set NAME`._
- **Variables:** `GMAIL_CLIENT_ID`, `BRIEF_SENDER`, `BRIEF_RECIPIENT`, plus any of the
  optional model overrides
  - _Tip: use `gh variable set NAME`._

The other two workflows handle CI on pull requests and apply migrations on merge to main.

## Tuning the brief

The two prompts — newsletter cleanup and brief compose — live in the database, versioned
append-only, so you can change how the brief reads without a deploy:

```sh
pnpm instructions:get compose               # show the live prompt
pnpm instructions:get compose --history     # every version
pnpm instructions:set compose --file prompt.md --note "why"
```

The same prompts are checked in at [src/ai/instructions.ts](src/ai/instructions.ts) as
the seed and fallback. To iterate on wording without touching mail, save a corpus to a
file — `pnpm start:dry --print-corpus`, or the `corpus` column of a past `Brief` — and
run just the compose stage over it:

```sh
pnpm eval:compose corpus.md   # writes corpus.brief.md next to the input
```

That harness runs against the checked-in defaults, not the database versions.

## Development

```sh
pnpm test        # Vitest unit tests
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier
```
