import { Marked } from 'marked'

// A single configured Markdown parser, reused per run (mirrors the Turndown
// singleton in parse/newsletter.ts). GFM so the composer's Markdown — headings,
// bold headlines, and `[1](url)` link lines — renders as expected.
const marked = new Marked({ gfm: true })

// Minimal, clean email styling: system font stack, a comfortable reading column,
// styled h2 section headings with a light rule, blue links, and light/dark support.
// Inlined in a <style> block — Gmail keeps head styles for the rendered view, and
// the text/plain part is the fallback for clients that strip them.
const STYLES = `
  :root {
    color-scheme: light dark;
    --fg: #1a1a1a;
    --muted: #555;
    --bg: #ffffff;
    --link: #0b57d0;
    --rule: #e3e3e3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e8e8e8;
      --muted: #a8a8a8;
      --bg: #1a1a1a;
      --link: #8ab4f8;
      --rule: #3a3a3a;
    }
  }
  body {
    margin: 0;
    padding: 24px 20px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
      Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
  }
  main {
    max-width: 640px;
    margin: 0 auto;
  }
  h2 {
    margin: 32px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
    font-size: 20px;
    font-weight: 600;
  }
  h2:first-child {
    margin-top: 0;
  }
  p {
    margin: 0 0 14px;
  }
  a {
    color: var(--link);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  strong {
    font-weight: 600;
  }
  em {
    color: var(--muted);
  }
`

/**
 * Render a Markdown brief body to a standalone HTML document for the email's
 * text/html part. Deterministic and side-effect free (no model) — exported for
 * unit tests. The Markdown itself is left untouched as the stored/plaintext form;
 * only the email transport uses this.
 */
export function renderBriefHtml(markdown: string): string {
  const content = marked.parse(markdown, { async: false })
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}</style>
</head>
<body>
<main>
${content}
</main>
</body>
</html>`
}
