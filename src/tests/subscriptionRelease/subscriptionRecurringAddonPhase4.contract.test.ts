import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

describe('Phase 4 recurring lead add-on scaling release contract', () => {
  it('uses maxAddonLeadCapacity as the canonical new-plan field with legacy read compatibility', () => {
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const helper = read('src/app/module/subscriptionPlan/planAddonCapacity.ts')
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    expect(model).toContain('maxAddonLeadCapacity')
    expect(model).toContain('default: undefined')
    expect(helper).toContain('maxRecurringLeadAddon')
    expect(helper).toContain('delete next.maxRecurringLeadAddon')
    expect(validation).toContain('maxAddonLeadCapacity: nonNegativeInteger.nullable().optional()')
  })

  it('ships the recommended current-plan ceilings', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain('maxAddonLeadCapacity: 2000')
    expect(service).toContain('maxAddonLeadCapacity: 5000')
    expect(service).toContain('maxAddonLeadCapacity: 20000')
  })

  it('allows repeated purchases of the same add-on unit and enforces the aggregate ceiling', () => {
    const addon = read('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts')
    expect(addon).toContain('addonCapacityWithinLimit')
    expect(addon).toContain('currentAddonCapacity: committed')
    expect(addon).not.toContain('already have this recurring lead add-on')
  })

  it('calculates effective capacity from base, recurring add-ons, legacy top-ups, then admin adjustment', () => {
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    expect(entitlement).toContain('planLeadCapacity + activeRecurringLeadAllowance + activeTopupLeadAllowance')
    expect(entitlement.indexOf('activeRecurringLeadAllowance')).toBeLessThan(entitlement.indexOf('activeTenantOverride'))
    expect(entitlement).toContain('adminAdjustmentCapacity')
    expect(entitlement).toContain('effectiveLeadCapacity')
  })

  it('returns a transparent recurring billing breakdown', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    expect(billing).toContain('basePlanPrice')
    expect(billing).toContain('recurringAddonPrice')
    expect(billing).toContain('totalRecurringPrice')
    expect(billing).toContain('billingSummary')
  })

  it('migrates by creating new current versions without moving existing tenants', () => {
    const migration = read('src/app/db/migrateSubscriptionRecurringAddonScalingV4.ts')
    const pkg = JSON.parse(read('package.json'))
    expect(migration).toContain('tenantAssignmentMutation: false')
    expect(migration).toContain('historicalBenefitPeriodMutation: false')
    expect(migration).toContain("status: 'grandfathered'")
    expect(migration).toContain("status: 'current'")
    expect(migration).not.toContain('organizations.update')
    expect(pkg.scripts['migrate:subscription-recurring-addon-v4']).toContain('migrateSubscriptionRecurringAddonScalingV4.ts')
  })
})
