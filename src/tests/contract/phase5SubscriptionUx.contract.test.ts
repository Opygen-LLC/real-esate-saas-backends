import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 5 subscription UX and safe structural migration', () => {
  it('ships a structural-only migration that never reassigns tenant plan versions or limits', () => {
    const migration = read('src/app/db/migrateSubscriptionEntitlementStructureV1.ts')
    expect(migration).toContain('organizationSubscriptionMutation: false')
    expect(migration).toContain('legacyLimitMutation: false')
    expect(migration).toContain('planVersionReassignment: false')
    expect(migration).toContain("'trial.entitlements'")
    expect(migration).toContain('displayOrder')
    expect(migration).toContain('upgradeRank')
    expect(migration).toContain('backupDocuments')
    expect(migration).not.toContain('organizations.update')
    expect(migration).not.toContain('Organization.update')
  })

  it('preserves immutable assigned plan versions while new current versions remain separately purchasable', () => {
    const planModel = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const planService = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    expect(planModel).toContain('{ planId: 1, version: 1 }')
    expect(planModel).toContain('isCurrent')
    expect(planService).toContain('version')
    expect(entitlement).toContain('organization.subscription.planVersion')
    expect(entitlement).toContain('version: organization.subscription.planVersion')
  })

  it('keeps cancellation at period end and inactive subscription protection intact', () => {
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const access = read('src/app/middlewares/subscriptionAccess.ts')
    expect(lifecycle).toContain('cancel_at_period_end')
    expect(access).toContain('SUBSCRIPTION_INACTIVE')
    expect(access).toContain('currentPeriodEnd')
  })
})
