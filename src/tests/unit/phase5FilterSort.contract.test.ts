import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 5 server-side filter and sort contract', () => {
  it('whitelists property sort fields and keeps property reads tenant scoped', () => {
    const service = read('src/app/module/property/property.service.ts')
    const controller = read('src/app/module/property/property.controller.ts')
    const crmRoute = read('src/app/module/crm/crm.route.ts')

    expect(service).toContain("new Set(['createdAt', 'updatedAt', 'price', 'title', 'status', 'city', 'propertyType', 'listingType', 'bedrooms', 'bathrooms', 'isFeatured'])")
    expect(service).toContain("allowedSort.has(sortBy) ? sortBy : 'createdAt'")
    expect(service).toContain('organizationId')
    expect(controller).toContain("'agentId'")
    expect(controller).toContain("'isFeatured'")
    expect(crmRoute).toContain("requireAnyPermission('properties.read', 'leads.read'")
  })

  it('supports task due ranges, overdue and approval filters with a strict sort allowlist', () => {
    const service = read('src/app/module/task/task.service.ts')
    const controller = read('src/app/module/task/task.controller.ts')
    const taskInterface = read('src/app/module/task/task.interface.ts')

    for (const field of ['dueFrom', 'dueTo', 'overdue', 'approvalStatus']) {
      expect(service).toContain(field)
      expect(controller).toContain(field)
      expect(taskInterface).toContain(field)
    }
    expect(service).toContain("new Set(['dueAt', 'createdAt', 'updatedAt', 'priority', 'status', 'approvalStatus', 'title'])")
    expect(service).toContain("allowedSort.has(sortBy) ? sortBy : 'dueAt'")
  })

  it('validates money amount ranges and whitelists transaction sorting', () => {
    const service = read('src/app/module/finance/finance.service.ts')

    expect(service).toContain('minAmount')
    expect(service).toContain('maxAmount')
    expect(service).toContain('Maximum amount must be greater than or equal to minimum amount')
    expect(service).toContain("new Set(['transactionDate', 'amount', 'createdAt', 'updatedAt', 'category', 'status', 'paymentMethod'])")
  })

  it('keeps billing sort fields entity-specific instead of sharing invoice sorts', () => {
    const service = read('src/app/module/finance/finance.service.ts')

    expect(service).toContain("new Set(['issueDate', 'dueDate', 'total', 'paidAmount', 'createdAt', 'updatedAt', 'status'])")
    expect(service).toContain("new Set(['createdAt', 'dueDate', 'commissionAmount', 'agentShare', 'companyShare', 'status'])")
    expect(service).toContain("new Set(['name', 'category', 'createdAt', 'updatedAt', 'status'])")
  })

  it('CRM lead/contact list sorting remains allowlisted in the shared read model', () => {
    const service = read('src/app/module/crm/crmListReadModel.service.ts')

    for (const field of ['followUpDate', 'leadScore', 'budgetMin', 'budgetMax', 'convertedAt', 'statusAtConversion']) {
      expect(service).toContain(field)
    }
    expect(service).toContain('LEAD_SORT_FIELDS')
    expect(service).toContain('CONTACT_SORT_FIELDS')
  })
  it('rejects malformed numeric property and lead range filters instead of producing database cast errors', () => {
    const propertyService = read('src/app/module/property/property.service.ts')
    const leadService = read('src/app/module/lead/lead.service.ts')

    expect(propertyService).toContain('Maximum price must be greater than or equal to minimum price')
    expect(propertyService).toContain('must be a non-negative number')
    expect(leadService).toContain('maxBudget must be greater than or equal to minBudget')
    expect(leadService).toContain('minScore must be between 0 and 100')
  })

})
