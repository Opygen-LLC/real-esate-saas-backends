import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { tenantResourceFilter } from '../../app/repositories/tenantRepository'

const root = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('phase 3 tenant-isolation source matrix', () => {
  it('tenantResourceFilter fails closed when a victim id is known', () => {
    expect(tenantResourceFilter('org-a', '507f1f77bcf86cd799439011')).toEqual({
      organizationId: 'org-a',
      _id: '507f1f77bcf86cd799439011',
    })
  })

  it.each([
    ['Finance', 'src/app/module/finance/finance.service.ts', /TenantReferenceService\.(?:assertProperty|assertLead|assertFinanceVendor).*organizationId|organizationId[\s\S]{0,180}TenantReferenceService/],
    ['Customer Finance', 'src/app/module/customerFinance/customerFinance.service.ts', /findOne\(\{[^}]*_id:[^}]*organizationId/],
    ['Properties', 'src/app/module/property/property.service.ts', /organizationId/],
    ['Property ownership', 'src/app/module/property/propertyOwnership.service.ts', /organizationId/],
    ['Suppliers', 'src/app/module/supplierManagement/supplierManagement.service.ts', /findOne\(\{[^}]*_id:[^}]*organizationId/],
    ['Materials', 'src/app/module/materialInventory/materialInventory.service.ts', /findOne\(\{[^}]*_id:[^}]*organizationId/],
    ['CRM', 'src/app/module/crm/crm.service.ts', /organizationId/],
  ])('%s linked-record lookups retain tenant context', (_label, relative, pattern) => {
    expect(read(relative), relative).toMatch(pattern)
  })

  it('website-content mutations use immutable authenticated tenant context', () => {
    for (const relative of [
      'src/app/module/banner/banner.controller.ts',
      'src/app/module/section/section.controller.ts',
      'src/app/module/landingPage/landingPage.controller.ts',
    ]) {
      const source = read(relative)
      expect(source, relative).toMatch(/requireTenant\(req\)/)
      expect(source, relative).not.toMatch(/req\.body\.organizationId/)
      expect(source, relative).toMatch(/tenantResourceFilter\(requireTenant\(req\), id\)/)
    }
  })
})
