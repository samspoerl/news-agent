import { parseSender } from '@/gmail/read'
import { describe, expect, it } from 'vitest'

describe('parseSender', () => {
  it('parses a "Name <email>" header', () => {
    expect(parseSender('Alice <alice@x.com>')).toEqual({
      email: 'alice@x.com',
      name: 'Alice',
    })
  })

  it('lowercases the address and falls back to it as the name', () => {
    expect(parseSender('BOB@X.com')).toEqual({
      email: 'bob@x.com',
      name: 'bob@x.com',
    })
  })

  it('returns null when there is no usable address', () => {
    expect(parseSender('not an email')).toBeNull()
    expect(parseSender(undefined)).toBeNull()
  })
})
