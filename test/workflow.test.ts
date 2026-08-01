import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #17 lived in the workflow as much as in the parser: a `--` in the dispatch
// command made the `date` input a silent no-op in prod, so every backfill sent a
// normal brief for today instead. Unit tests on parseArgs alone would not have
// caught that, so assert the shape of the command CI actually runs.
const WORKFLOW = new URL(
  '../.github/workflows/daily-brief.yml',
  import.meta.url
)

describe('daily-brief workflow', () => {
  const invocations = readFileSync(WORKFLOW, 'utf8')
    .split('\n')
    .filter((line) => line.includes('pnpm start'))

  it('invokes the run exactly once', () => {
    // The assertions below read the one line; more than one means they miss a path.
    expect(invocations).toHaveLength(1)
  })

  it('passes the backfill date as a flag, with no `--` separator', () => {
    const [run] = invocations
    expect(run).toContain('--date "$BRIEF_DATE"')
    // pnpm forwards a literal `--` to the script, where it ends option parsing —
    // the flag after it never reaches the run.
    expect(run).not.toMatch(/(^|\s)--(\s|$)/)
  })

  it('reads the date from the environment, never an interpolation', () => {
    // A `${{ inputs.* }}` inside `run:` is a shell-injection vector.
    expect(invocations[0]).not.toContain('${{')
  })
})
