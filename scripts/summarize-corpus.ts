import 'dotenv/config'
import { composeBrief } from '@/ai/compose'
import { DEFAULT_INSTRUCTIONS } from '@/ai/instructions'
import { tokenizeLinkUrls } from '@/brief/links'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Eval harness for the compose stage. Reads a corpus Markdown file, runs the real
 * composer (src/ai/compose.ts) — link tokenization, restore and fidelity guard
 * included — prints the brief, and writes it next to the input as <name>.brief.md.
 *
 * Because it calls the same composeBrief the daily run uses, it stays in sync with
 * production — tweak the model/prompt in one place and re-run this on stored
 * corpora (e.g. a Brief.corpus dumped to a file) to compare output.
 *
 *   pnpm eval:compose <file.md>
 *
 * Needs AI_GATEWAY_API_KEY in the environment (.env).
 */
async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: pnpm eval:compose <file.md>')
    process.exit(1)
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('AI_GATEWAY_API_KEY is not set (add it to .env).')
    process.exit(1)
  }

  const corpus = readFileSync(file, 'utf8')
  // What composeBrief will actually send, reported here so a prompt/model change can
  // be judged against its input cost. The composer itself tokenizes internally.
  const { text: tokenized, urls } = tokenizeLinkUrls(corpus)
  const saved = corpus.length - tokenized.length
  console.log(
    `Corpus: ${file} (${corpus.length.toLocaleString()} chars)\n` +
      `Sending: ${tokenized.length.toLocaleString()} chars — ${urls.length} link(s) tokenized, ` +
      `${saved.toLocaleString()} chars saved (${Math.round((saved / corpus.length) * 100)}%)\n` +
      `Generating…\n`
  )

  // Uses the code-default compose prompt (id -1) so the harness stays DB-free;
  // nothing here is persisted.
  const started = performance.now()
  const {
    body: text,
    aiCall,
    droppedLinks,
  } = await composeBrief(corpus, {
    id: -1,
    body: DEFAULT_INSTRUCTIONS.COMPOSE,
  })
  const elapsed = ((performance.now() - started) / 1000).toFixed(1)

  if (droppedLinks.length)
    console.error(
      `! dropped ${droppedLinks.length} unverifiable link(s): ${droppedLinks.join(', ')}\n`
    )
  console.log(text)

  const outPath = join(dirname(file), `${basename(file, '.md')}.brief.md`)
  writeFileSync(outPath, text.trimEnd() + '\n')

  console.log(
    `\n── ${aiCall.model} · ${aiCall.inputTokens ?? '?'} in / ${aiCall.outputTokens ?? '?'} out tokens · ${elapsed}s`
  )
  console.log(`Wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
