# News Agent

A scheduled agent that ingests RSS feeds and newsletters once a day, triages what
matters, and emails a short awareness brief with links.

See [PLAN.md](PLAN.md) for the design and [AGENTS.md](AGENTS.md) for conventions.

## Setup

```sh
pnpm install
cp .env.example .env   # then fill in values
pnpm db:generate       # generate the Prisma client
```

## Usage

```sh
pnpm start       # run the daily agent
pnpm typecheck   # type-check the project
pnpm db:seed     # seed news sources
```

Requires Node 24+ and pnpm.
