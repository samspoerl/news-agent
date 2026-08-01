import { toPlainText } from '@/ai/utils'
import { describe, expect, it } from 'vitest'

describe('toPlainText', () => {
  it('strips tags and decodes common entities', () => {
    expect(toPlainText('<p>a &amp; b</p>')).toBe('a & b')
  })

  it('collapses whitespace and truncates to the cap', () => {
    expect(toPlainText('a\n\n   b')).toBe('a b')
    expect(toPlainText('abcdef', 3)).toBe('abc…')
  })

  it('returns an empty string for nullish input', () => {
    expect(toPlainText(null)).toBe('')
    expect(toPlainText(undefined)).toBe('')
  })
})
