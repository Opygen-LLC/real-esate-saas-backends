import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { OrganizationValidation } from '../../app/module/organization/organization.validation'
import { decodeKeysetCursor, encodeKeysetCursor, buildKeysetRange } from '../../app/helpers/keysetPagination'
import { escapeRegex, safeRegexPattern } from '../../app/helpers/searchQuery'

describe('Phase 3 website/data hardening helpers', () => {
  it.each([
    ['facebook', 'https://facebook.com/acme'],
    ['instagram', 'https://instagram.com/acme'],
    ['youtube', 'https://youtube.com/@acme'],
    ['youtube', 'https://youtu.be/example'],
    ['x', 'https://x.com/acme'],
    ['x', 'https://twitter.com/acme'],
  ])('accepts valid %s social URL', (platform, url) => {
    const result = OrganizationValidation.website.safeParse({ body: { socialLinks: { [platform]: url } } })
    expect(result.success).toBe(true)
  })

  it.each([
    ['facebook', 'http://facebook.com/acme'],
    ['facebook', 'https://example.com/acme'],
    ['instagram', 'https://facebook.com/acme'],
    ['youtube', 'https://vimeo.com/acme'],
    ['x', 'https://example.com/acme'],
  ])('rejects invalid %s social URL', (platform, url) => {
    const result = OrganizationValidation.website.safeParse({ body: { socialLinks: { [platform]: url } } })
    expect(result.success).toBe(false)
  })

  it('escapes regex metacharacters and caps hostile search input', () => {
    expect(escapeRegex('a.*(b)+?')).toBe('a\\.\\*\\(b\\)\\+\\?')
    expect(safeRegexPattern('  a.*(b)+?  ')).toBe('a\\.\\*\\(b\\)\\+\\?')
    expect(() => safeRegexPattern('x'.repeat(121))).toThrow(/120 characters or fewer/)
  })

  it('round-trips stable keyset cursors and builds a tie-breaker range', () => {
    const id = new Types.ObjectId()
    const value = new Date('2026-08-31T00:00:00.000Z')
    const decoded = decodeKeysetCursor(encodeKeysetCursor(value, id))!
    expect(decoded).toEqual({ value: value.toISOString(), id: id.toString() })
    expect(buildKeysetRange('createdAt', 'desc', decoded, (raw) => new Date(String(raw)))).toEqual({
      $or: [
        { createdAt: { $lt: value } },
        { createdAt: value, _id: { $lt: id } },
      ],
    })
  })
})
