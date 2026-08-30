import { describe, expect, it } from 'vitest'
import ApiError from '../../errors/ApiError'
import {
  determineUserDataExportScope,
  parseUserDataExportSections,
  rowsToCsv,
  USER_DATA_EXPORT_SECTIONS,
} from '../../app/module/user/userDataExport.service'

describe('user profile data export contract', () => {
  it('defaults to every supported export section and de-duplicates explicit selections', () => {
    expect(parseUserDataExportSections()).toEqual([...USER_DATA_EXPORT_SECTIONS])
    expect(parseUserDataExportSections('leads,properties,leads')).toEqual(['leads', 'properties'])
  })

  it('rejects unsupported sections instead of silently exporting unexpected data', () => {
    expect(() => parseUserDataExportSections('leads,secrets')).toThrow(ApiError)
  })

  it('makes only the agency owner operational export organization-wide', () => {
    expect(determineUserDataExportScope('agency_owner')).toBe('organization')
    expect(determineUserDataExportScope('agency_admin')).toBe('self')
    expect(determineUserDataExportScope('agent')).toBe('self')
    expect(determineUserDataExportScope('staff')).toBe('self')
  })

  it('keeps relationship IDs/nested values in CSV and neutralizes spreadsheet formulas', () => {
    const csv = rowsToCsv([{ _id: 'abc', propertyInterest: ['p1', 'p2'], note: '=SUM(1,1)' }])
    expect(csv).toContain('propertyInterest')
    expect(csv).toContain('[""p1"",""p2""]')
    expect(csv).toContain("'=SUM(1,1)")
  })
})
