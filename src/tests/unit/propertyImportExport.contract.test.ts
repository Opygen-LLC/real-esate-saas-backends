import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 6 property import/export contract', () => {
  it('exposes only preview/confirm spreadsheet writes and both template/export formats', () => {
    const route = read('src/app/module/property/property.route.ts')
    for (const endpoint of ["'/import/template.csv'", "'/import/template.xlsx'", "'/import/preview'", "'/import/confirm'", "'/export/csv'", "'/export/xlsx'"]) {
      expect(route).toContain(endpoint)
    }
    expect(route).toContain("requirePermission('properties.write')")
    expect(route).toContain("requirePermission('properties.read')")
    expect(route).not.toMatch(/post\(['"]\/import['"]/)
  })

  it('reuses one hardened CSV/XLSX parser for Lead and Property imports', () => {
    const shared = read('src/app/module/import/spreadsheetImport.service.ts')
    const lead = read('src/app/module/lead/leadImport.service.ts')
    const property = read('src/app/module/property/propertyImport.service.ts')
    expect(shared).toContain('assertSafeXlsxArchive')
    expect(shared).toContain('MAX_XLSX_UNCOMPRESSED_BYTES')
    expect(shared).toContain('parseSpreadsheetUpload')
    expect(lead).toContain("parseSpreadsheetUpload(file, {")
    expect(property).toContain("parseSpreadsheetUpload(file, { maxRows: MAX_IMPORT_ROWS, entityLabel: 'Property' })")
  })

  it('rejects system-owned property import fields and tenant-unsafe agents', () => {
    const service = read('src/app/module/property/propertyImport.service.ts')
    for (const field of ['organizationid', 'createdby', 'updatedby', 'slug', 'views', 'publishedat', 'ownerid']) {
      expect(service).toContain(`'${field}'`)
    }
    expect(service).toContain('Property import cannot set system-managed column')
    expect(service).toContain("CrmAssignableMemberService.listAssignableMembers(organizationId, 'property')")
    expect(service).toContain("CrmAssignableMemberService.listAssignableMembers(organizationId, 'property', { ids: assignedIds, session: dbSession })")
    expect(service).toContain('Agent ID is not an active assignable member of this agency')
  })

  it('stores a one-time tenant/user-bound preview and checks entitlement before creation', () => {
    const service = read('src/app/module/property/propertyImport.service.ts')
    expect(service).toContain("IMPORT_SESSION_NAMESPACE = 'property-import'")
    expect(service).toContain("redis.call('DEL',KEYS[1])")
    expect(service).toContain('previewSession.organizationId !== organizationId || previewSession.userId !== actor.id')

    expect(service).toContain('EntitlementService.assertPropertyCapacity')


    expect(service).toContain('PropertyService.createProperty(organizationId, payload, actor')

  })

  it('exports through the exact list filter builder and an explicit property sort allowlist', () => {
    const service = read('src/app/module/property/property.service.ts')
    expect(service).toContain('buildPropertyWhereCondition({ ...filters, organizationId })')
    expect(service).toContain('PROPERTY_SORT_FIELDS')
    expect(service).toContain('safePropertySort')
    expect(service).toContain('MAX_PROPERTY_EXPORT_ROWS = 20_000')
    expect(service).toContain("buildCrmCsv(PROPERTY_EXPORT_COLUMNS")
    expect(service).toContain("buildCrmXlsx('Properties', PROPERTY_EXPORT_COLUMNS")
  })
})
