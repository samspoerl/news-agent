// Matches an inline Markdown link: [label](url) or [label](url "title").
// The URL is any run of non-space, non-`)` characters — enough for the http(s)
// links our sources carry, and it never spans past the closing paren.
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** Every URL that appears in a Markdown link, in document order (with repeats). */
export function markdownLinkUrls(markdown: string): string[] {
  return [...markdown.matchAll(MD_LINK)].map((m) => m[2])
}

// A short, model-stable stand-in for a link URL. Distinctive enough not to occur
// in real content, and trivially exact-matched on the way back.
const LINK_TOKEN = /\{\{LINK(\d+)\}\}/g

/**
 * Replace every Markdown link's URL with a short `{{LINKn}}` token, returning the
 * tokenized text and the URLs in order. Lets a model work on the prose around links
 * without ever seeing — or being able to corrupt — the real (often long, opaque)
 * URLs. Pair with restoreLinks.
 *
 * A repeated URL gets the same token every time, so "these two sources point at the
 * same article" survives tokenization — signal the model would otherwise have read
 * off the URLs themselves.
 */
export function tokenizeLinkUrls(markdown: string): {
  text: string
  urls: string[]
} {
  const urls: string[] = []
  const seen = new Map<string, string>()
  const text = markdown.replace(
    MD_LINK,
    (_whole, label: string, url: string) => {
      let token = seen.get(url)
      if (token === undefined) {
        token = `{{LINK${urls.length}}}`
        seen.set(url, token)
        urls.push(url)
      }
      return `[${label}](${token})`
    }
  )
  return { text, urls }
}

/**
 * Restore `{{LINKn}}` tokens to their exact URLs. Tokens the model dropped simply
 * don't appear; a token the model mangled won't match and is left for the caller's
 * link-fidelity check to strip.
 */
export function restoreLinkUrls(markdown: string, urls: string[]): string {
  return markdown.replace(
    LINK_TOKEN,
    (whole, i: string) => urls[Number(i)] ?? whole
  )
}

/**
 * The link-fidelity guard. Remove any Markdown link whose URL does not appear
 * verbatim in `haystack`, leaving the link's label text in place. Returns the
 * cleaned Markdown and the URLs that were dropped.
 *
 * Used at two seams so no model-touched URL can ever reach the inbox:
 *   1. a cleaned newsletter vs. its raw HTML (guards the cleanup model), and
 *   2. the composed brief vs. the corpus (guards the composer).
 */
export function dropLinksNotIn(
  markdown: string,
  haystack: string
): { text: string; removed: string[] } {
  const removed: string[] = []
  const text = markdown.replace(
    MD_LINK,
    (whole, label: string, url: string) => {
      if (haystack.includes(url)) return whole
      removed.push(url)
      return label
    }
  )
  return { text, removed }
}

/**
 * Un-tokenize a model's output: restore `{{LINKn}}` to its exact URL, drop any link
 * whose URL isn't one of the originals (a mangled token, or a URL the model invented
 * outright), and sweep any bare token left outside of link syntax. The counterpart to
 * tokenizeLinkUrls, and the whole post-model link path for both model seams.
 *
 * The fidelity haystack is the original URLs rather than the source text, which is
 * entity-safe: both sides come from the same tokenize pass.
 */
export function restoreLinks(
  modelOutput: string,
  urls: string[]
): { text: string; removed: string[] } {
  const restored = restoreLinkUrls(modelOutput, urls)
  const { text, removed } = dropLinksNotIn(restored, urls.join('\n'))
  return { text: text.replace(LINK_TOKEN, ''), removed }
}

/**
 * Remove every Markdown link, keeping its label text. Used where a model needs the
 * prose but has no use for the URLs — the recent briefs passed to the composer as
 * dedup context, where a full source-link line is pure token cost.
 */
export function stripLinks(markdown: string): string {
  return markdown.replace(MD_LINK, (_whole, label: string) => label)
}
