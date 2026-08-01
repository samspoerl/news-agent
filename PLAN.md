# Design — Daily News Agent

A scheduled agent that reads news once a day, decides what actually matters, and
emails the developer a short awareness brief with links.

This is the design doc — the reasoning behind the pipeline and the invariants it has
to keep. See [AGENTS.md](AGENTS.md) for the stack, project structure, commands, and
conventions.

## Motivation

There's an overwhelming amount of news these days, and a lot of it is bad news.
I want to be only informed enough to not be considered living under a rock and
to not get caught unaware of major tech developments at work.

## What it does

Every morning, produce a daily news brief email with up to two sections:

1. **Need-to-know** — global or national (U.S.) news significant enough that not
   knowing it means living under a rock. Expected to be sparse (maybe a few times
   a month). Sourced from newsletters for quality, curated content and to avoid paywalls.
2. **Tech news** — things a working software engineer shouldn't be caught unaware of:
   major model releases, notable tooling shifts, whatever everyone's talking about.
   Sourced from RSS feeds (e.g., [Hacker News](https://hnrss.org/frontpage)).

Each item is **a one line summary + 1-3 sentence detail + a link**. Awareness, not briefing.
If I want depth, I click through.

## Core principles (these drive the design)

- **Awareness only.** Headline-level. The email body carries enough to know a thing
  happened; the link carries the rest. This is why paywalls don't block us —
  newsletters hand us the headline + dek + link in the email body.

- **No news is okay.** This is a feature:
  1. The composer discards by default — an item must clear a high bar to appear,
     and either section may be "_Nothing today._".
  2. An empty corpus (nothing fetched) short-circuits to "No news today!" with no
     model call.
  3. Either way, the send is a success, not an error to alarm on.

- **Fixed daily cadence.** One scheduled run, one brief. No breaking-news alerts,
  no off-cycle sends, no live search. Backfill (`--date`) is not an exception to
  this: it reconstructs a run that was supposed to happen and didn't, producing the
  brief that day was owed. The cadence still comes entirely from the schedule —
  nothing about the world's events can trigger a send.

- **Links are sacrosanct.** A brief's value is the click-through, so no fabricated
  or mangled URL may ever ship. RSS links are rendered deterministically (never
  seen by a model). Neither model ever sees a URL at all: newsletter URLs are
  tokenized before the cleanup model and the corpus's before the composer, restored
  exactly after in both cases — which also keeps the corpus's long tracking URLs out
  of the compose bill. Two deterministic guards then drop any link not present
  verbatim in its source (cleaned newsletter ⊆ raw, brief ⊆ corpus).

## Data model

See [schema.prisma](prisma/schema.prisma). In short:

- **Source** — an RSS feed or newsletter sender; `active: false` mutes it.
- **SourceDocument** — one source's contribution to one run: the `raw` feed/email
  and the cleaned `markdown` that went into that run's corpus (RSS: one per feed;
  newsletters: one per email). Carries `gmailMessageId` (newsletters) as a work-reuse
  key — a run reuses a prior run's cleaned Markdown for the same email rather than
  re-paying the cleanup model across the lookback overlap — and `feedBuildDate` (RSS)
  as stale-feed provenance. No cross-run item dedup; content dedup is the composer's
  job against recent briefs.
- **Brief** — the sent brief plus the exact `corpus` handed to the composer (so a
  run is replayable) and the cross-day dedup memory (recent bodies).
- **AiCall** — one model invocation's params + token usage, for evals; references
  the `Instructions` version used, and its `SourceDocument` (cleanup) or `Brief`
  (compose).
- **Instructions** — a versioned, append-only prompt per task; the current prompt
  is the latest row, so prompts can be tuned in the DB without shipping code.

## Pipeline

One run is `fetch → parse → compose → send → persist`, and it writes nothing until
after a successful send (a failed run leaves no partial state):

1. **Fetch** active RSS feeds (raw XML) and recent inbox newsletters (raw HTML).
2. **Parse** each source to Markdown, in parallel: RSS deterministically; each
   newsletter via strip → Turndown → cheap-model cleanup (URLs tokenized/restored).
   One failing feed or newsletter is skipped, never fatal. A newsletter already
   cleaned by a recent run (matched on its Gmail id) reuses that Markdown instead
   of calling the cleanup model again.
3. **Compose** the whole corpus in a single strong-model pass — triage, cluster,
   dedup against the last two briefs, write. URLs are tokenized/restored around the
   call, and any link not in the corpus is dropped. The stored `Brief.corpus` is the
   untokenized text, so it stays replayable.
4. **Send** via Gmail as `multipart/alternative` — the Markdown rendered to HTML for
   the body, with the Markdown itself as the plain-text fallback. The stored brief
   stays Markdown.
5. **Persist** the brief, corpus, every SourceDocument, and every AiCall atomically.
6. **Archive** the newsletters the brief was built from — label them `PROCESSED`
   and drop them out of the inbox so the next run's `in:inbox` search skips them.
   Best-effort (the brief is already sent and recorded, so a labeling hiccup is
   logged, not fatal) and skipped for `--sample-inbox` so its `label:TEST` set stays
   reusable. A `--dry-run` never reaches this step.

Steps 1, 4, and 6 all talk to Gmail under a single OAuth scope, `gmail.modify` —
Google grants read, compose, and send under it, so a separate `gmail.send` isn't
needed. See [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Testing spans three layers: **unit tests** (Vitest) over the pure/deterministic
pieces; **AI evals** for tuning models, reasoning, and prompts on versioned inputs;
and a **full pipeline run** with `--dry-run`, which runs steps 1–3 and prints the
brief instead of sending or persisting. A dry run still reads history and reuses
cleanup like production — repeatability belongs to the evals, not the pipeline run.
See [AGENTS.md](AGENTS.md) for the commands and flags.

## Safety rails

- **Send target comes only from `BRIEF_RECIPIENT`.** The run reads the recipient from
  that env var and throws if it's unset — it never falls back to a guessed or
  model-supplied address, so mail can't fan out anywhere else.
- **Instructions in fetched content are data, not commands.** Newsletter/RSS body
  text is never treated as instructions to the agent.
- **Allow-by-default newsletter intake is deliberately permissive but bounded.**
  Any inbox sender's mail enters the LLM pipeline, so the injection surface is
  wide — but the blast radius is small: the cleanup and compose models have no
  tools (they can only emit Markdown, never read other mail or send anything),
  Gmail's spam filter and `in:inbox` scope keep junk out, content is treated as
  data (above), and the composer's discard-by-default bar drops a stray
  non-newsletter. Even if injected text coaxed a model into emitting a malicious
  link, the URL guards drop anything not present verbatim in the fetched source.

## Out of scope

- Breaking-news / event-driven off-cycle sends. (Backfilling a _missed_ scheduled
  day is in scope — see the cadence principle above.)
- A live search API as a gap-filler.
- Deep multi-paragraph summaries.
