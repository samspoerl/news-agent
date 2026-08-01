/**
 * Flatten item text to a compact plain-text snippet for prompting: strip HTML
 * tags (RSS bodies can be raw HTML — e.g. the Atom <summary> fallback), decode
 * the handful of common entities that leaves behind, collapse whitespace, and
 * truncate. Keeps token counts down and signal up.
 */
export function toPlainText(
  input: string | null | undefined,
  maxLen = 1000
): string {
  if (!input) return ''
  const decoded = input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
  const collapsed = decoded.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLen
    ? collapsed.slice(0, maxLen).trimEnd() + '…'
    : collapsed
}
