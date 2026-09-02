import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Phase 5 ownership and accounting separation', () => {
  it('uses independent company shareholder and property ownership models', () => {
    const propertyModels = read('src/app/module/property/propertyOwnership.model.ts')
    const capitalModels = read('src/app/module/finance/financeCapital.model.ts')
    expect(propertyModels).toContain("model<IPropertyOwner>('PropertyOwner'")
    expect(propertyModels).toContain("model<IPropertyInvestor>('PropertyInvestor'")
    expect(propertyModels).toContain("model<IPropertyInvestment>('PropertyInvestment'")
    expect(propertyModels).toContain("model<IPropertyInvestorDistribution>('PropertyInvestorDistribution'")
    expect(propertyModels).not.toContain('FinanceShareholder')
    expect(capitalModels).toContain('FinanceShareholder')
  })

  it('requires property and finance write permission for actual investor money movement', () => {
    const routes = read('src/app/module/property/property.route.ts')
    for (const route of ['contributions', 'distributions']) {
      const line = routes.split('\n').find((value) => value.includes(`/ownership/investors/:investorId/${route}`) && !value.includes('/reverse'))
      expect(line).toBeTruthy()
      expect(line).toContain("requirePermission('properties.write')")
      expect(line).toContain("requirePermission('finance.write')")
      expect(line).toContain('rejectAccountingMigrationLock')
    }
  })

  it('keeps ownership metadata non-financial and posts only contribution/distribution actions', () => {
    const service = read('src/app/module/property/propertyOwnership.service.ts')
    const createOwnerStart = service.indexOf('const createOwner')
    const createInvestorStart = service.indexOf('const createInvestor')
    const createInvestmentStart = service.indexOf('const createInvestment')
    expect(createOwnerStart).toBeGreaterThan(-1)
    expect(createInvestorStart).toBeGreaterThan(-1)
    expect(createInvestmentStart).toBeGreaterThan(-1)
    expect(service.slice(createOwnerStart, createInvestorStart)).not.toContain('postPropertyInvestorMovement')
    expect(service.slice(createInvestorStart, createInvestmentStart)).not.toContain('postPropertyInvestorMovement')
    expect(service.slice(createInvestmentStart)).toContain('postPropertyInvestorMovement')
  })

  it('keeps company equity/dividend actions behind shareholder management permission', () => {
    const routes = read('src/app/module/finance/finance.route.ts')
    expect(routes).toMatch(/accounting\/equity-transactions[^\n]+finance\.shareholders\.manage/)
    expect(routes).toMatch(/accounting\/dividends[^\n]+finance\.shareholders\.manage/)
  })
})
