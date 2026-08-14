import { describe, expect, it } from 'vitest'
import { divisions_en } from 'bangladesh-location-data'
import { divisions_bn } from 'bangladesh-location-data/bangla'
import { normalizeBangladeshPhone, normalizeDigits } from '../../helpers/identity'
import { decryptField, encryptField } from '../../helpers/fieldEncryption'
import { LocalizationService } from './localization.service'

describe('Bangladesh localization', () => {
  it('normalizes Bangla digits in local and country-code phone formats', () => {
    expect(normalizeDigits('১২৩৪৫৬৭৮৯০')).toBe('1234567890')
    expect(normalizeBangladeshPhone('০১৭১-২৩৪৫৬৭৮')).toBe('+8801712345678')
    expect(normalizeBangladeshPhone('+৮৮০ ১৭১২৩৪৫৬৭৮')).toBe('+8801712345678')
  })

  it('serves the complete top-level administrative hierarchy bilingually', () => {
    const divisions = LocalizationService.getLocations('division', undefined, 'bn')
    expect(divisions).toHaveLength(8)
    expect(divisions.every(item => item.name && item.alternateName)).toBe(true)
    expect(LocalizationService.getLocations('district', '30', 'en').length).toBeGreaterThan(10)
  })

  it('pairs Bangla and English location names by stable location id', () => {
    const banglaById = new Map(divisions_bn.map(item => [String(item.value), item.title]))
    const englishById = new Map(divisions_en.map(item => [String(item.value), item.title]))
    const englishLocations = LocalizationService.getLocations('division', undefined, 'en')
    const banglaLocations = LocalizationService.getLocations('division', undefined, 'bn')

    expect(englishLocations.every(item => item.alternateName === banglaById.get(item.id))).toBe(true)
    expect(banglaLocations.every(item => item.alternateName === englishById.get(item.id))).toBe(true)
  })

  it('uses configurable regional katha and bigha conversions', () => {
    expect(LocalizationService.convertArea(1, 'katha', 'sqft').value).toBe(720)
    expect(LocalizationService.convertArea(1, 'bigha', 'katha', 800, 16).value).toBe(16)
    expect(LocalizationService.convertArea(1, 'shotok', 'decimal').value).toBe(1)
  })

  it('encrypts sensitive identifiers with authenticated randomized ciphertext', () => {
    const first = encryptField('1234567890123'); const second = encryptField('1234567890123')
    expect(first).not.toBe(second)
    expect(first).not.toContain('1234567890123')
    expect(decryptField(first)).toBe('1234567890123')
  })
})
