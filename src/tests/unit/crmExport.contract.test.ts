import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { sanitizeSpreadsheetValue } from '../../app/module/crm/crmExport.service'

describe('CRM Phase 11 export contract', () => {
  it('neutralizes spreadsheet formula injection in user-controlled CRM fields', () => {
    expect(sanitizeSpreadsheetValue('=HYPERLINK("https://example.invalid")')).toBe("'=HYPERLINK(\"https://example.invalid\")")
    expect(sanitizeSpreadsheetValue('+SUM(1,2)')).toBe("'+SUM(1,2)")
    expect(sanitizeSpreadsheetValue('Normal client')).toBe('Normal client')
  })

  it('reuses list filter builders and batched Activity projections for exports', () => {
    const leadService = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/lead/lead.service.ts'), 'utf8')
    const contactService = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/contact/contact.service.ts'), 'utf8')
    expect(leadService).toContain('buildLeadWhere({ ...filters, organizationId }, access)')
    expect(contactService).toContain('buildContactWhere({ ...filters, organizationId }, access)')
    expect(leadService).toContain('ActivityExportService.getLeadExportActivityProjection')
    expect(contactService).toContain('ActivityExportService.getContactExportActivityProjection')
  })

  it('makes crm.export grantable while preserving Lead and Contact read prerequisites', () => {
    const access = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/user/accessControl.ts'), 'utf8')
    expect(access).toContain("'crm.export': ['leads.read', 'contacts.read']")
    expect(access).toContain("permission: 'crm.export', label: 'Export CRM records'")
  })

  it('ships both CSV and XLSX routes behind read + crm.export permissions', () => {
    const leadRoute = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/lead/lead.route.ts'), 'utf8')
    const contactRoute = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/contact/contact.route.ts'), 'utf8')
    for (const route of [leadRoute, contactRoute]) {
      expect(route).toContain("'/export/csv'")
      expect(route).toContain("'/export/xlsx'")
      expect(route).toContain("requirePermission('crm.export')")
    }
    expect(leadRoute).toContain("requirePermission('leads.read')")
    expect(contactRoute).toContain("requirePermission('contacts.read')")
  })
})
