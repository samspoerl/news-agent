import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Format only the files changed since the last commit — staged, unstaged, and
 * untracked alike — instead of the whole repo, so a format pass never churns
 * files you didn't touch. Runs the real prettier CLI, so it honors the project
 * config, .prettierignore, and --ignore-unknown (non-formattable files are
 * skipped). Gitignored paths (e.g. the generated Prisma client) are never listed.
 *
 * Run:  pnpm format:changes
 */

function gitLines(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf-8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// Tracked edits vs HEAD (staged + unstaged, minus deletions) plus untracked,
// non-ignored files. existsSync guards against a rename's stale old path.
const changed = [
  ...gitLines(['diff', '--name-only', '--diff-filter=d', 'HEAD']),
  ...gitLines(['ls-files', '--others', '--exclude-standard']),
]
const files = [...new Set(changed)].filter((file) => existsSync(file))

if (files.length === 0) {
  console.log('No changed files to format.')
  process.exit(0)
}

// Invoke prettier's own CLI through node so this resolves regardless of platform
// or PATH shims (the .bin/prettier shim needs a shell on Windows; the .cjs doesn't).
const require = createRequire(import.meta.url)
const prettierBin = path.join(
  path.dirname(require.resolve('prettier')),
  'bin',
  'prettier.cjs'
)
execFileSync(
  process.execPath,
  [prettierBin, '--write', '--ignore-unknown', ...files],
  {
    stdio: 'inherit',
  }
)
