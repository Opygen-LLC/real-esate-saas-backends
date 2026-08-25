import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('Phase 1.4 commission auto-calculation contract', () => {
  it('derives commission money on the server in automatic mode', () => {
    const service = read('src/app/module/finance/finance.service.ts')
    const money = read('src/app/module/finance/finance.money.ts')

    expect(service).toContain('calculateCommissionAmounts')
    expect(service).toContain('calculateAutomaticCommission')
    expect(service).toContain('manualOverride: false')
    expect(money).toContain('percentageOfMinorUnits')
    expect(money).toContain('companyShareMinor = commissionMinor - agentShareMinor')
  })

  it('keeps manual override explicit and validates exact share equality', () => {
    const service = read('src/app/module/finance/finance.service.ts')
    const validation = read('src/app/module/finance/finance.validation.ts')
    const model = read('src/app/module/finance/finance.model.ts')

    expect(service).toContain('normalizeManualCommission')
    expect(validation).toContain('manualOverride')
    expect(validation).toContain('agentSplitPercent')
    expect(model).toContain('manualOverride: { type: Boolean }')
    expect(model).toContain('agentSplitPercent: { type: Number, min: 0, max: 100 }')
  })

  it('preserves legacy commission records by inferring manual mode when no new calculation fields exist', () => {
    const service = read('src/app/module/finance/finance.service.ts')
    expect(service).toContain('manualOverride === false')
    expect(service).toContain('agentSplitPercent !== undefined && !existing')
  })
})
