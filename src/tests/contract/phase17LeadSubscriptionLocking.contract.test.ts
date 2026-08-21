import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('lead subscription locking contract', () => {
  it('persists subscription lock provenance and the newest-first compound index', () => {
    const model = read('src/app/module/lead/lead.model.ts')
    const types = read('src/app/module/lead/lead.interface.ts')
    expect(types).toContain("export type ILeadLockReason = 'subscription_limit'")
    for (const field of ['isLocked', 'lockReason', 'lockedAt', 'lockedBy']) expect(types).toContain(field)
    expect(model).toContain("lockReason:{type:String,enum:['subscription_limit']")
    expect(model).toContain("leadSchema.index({organizationId:1,isLocked:1,createdAt:-1,_id:-1},{name:'lead_tenant_lock_created'})")
  })

  it('keeps exactly the newest N records accessible and never deletes overflow records', () => {
    const lockService = read('src/app/module/lead/leadEntitlement.service.ts')
    expect(lockService).toContain("sort({ createdAt: -1, _id: -1 })")
    expect(lockService).toContain('.limit(limit)')
    expect(lockService).toContain('Lead.updateMany')
    expect(lockService).toContain('LEAD_SUBSCRIPTION_LOCK_REASON')
    expect(lockService).not.toContain('Lead.deleteMany')
    expect(lockService).not.toContain('Lead.findOneAndDelete')
  })

  it('locks only active-capacity plans and releases subscription locks for grandfathered credit plans', () => {
    const resources = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    const reconciliation = read('src/app/module/entitlement/subscriptionEntitlementReconciliation.service.ts')
    expect(resources).toContain("current.leadAllowanceModel === 'active_capacity'")
    expect(resources).toContain('releaseSubscriptionLeadLocks')
    expect(reconciliation).toContain('leadAllowanceModel')
    expect(reconciliation).toContain("'paid_period_credits'")
  })

  it('enforces one canonical 402 guard across detail mutations, notes, history and activity bypass paths', () => {
    const guard = read('src/app/module/lead/leadEntitlement.service.ts')
    const lead = read('src/app/module/lead/lead.service.ts')
    const lifecycle = read('src/app/module/lead/leadLifecycle.service.ts')
    const activity = read('src/app/module/activity/activity.service.ts')
    expect(guard).toContain("'PLAN_UPGRADE_REQUIRED'")
    expect(guard).toContain("resource: 'leads'")
    expect(guard).toContain("reason: LEAD_SUBSCRIPTION_LOCK_REASON")
    expect(guard).toContain('recommendedPlan')
    expect(lead.match(/assertLeadAccessible/g)?.length || 0).toBeGreaterThanOrEqual(9)
    expect(lifecycle).toContain('assertLeadAccessible')
    expect(activity.match(/assertLeadAccessible/g)?.length || 0).toBeGreaterThanOrEqual(4)
  })

  it('blocks an export before querying raw rows whenever its filter includes locked records', () => {
    const lead = read('src/app/module/lead/lead.service.ts')
    const guard = read('src/app/module/lead/leadEntitlement.service.ts')
    expect(lead).toContain('assertExportContainsNoLockedLeads(organizationId, where)')
    expect(guard).toContain('lockedCount > 0')
    expect(guard).toContain("lockReason: LEAD_SUBSCRIPTION_LOCK_REASON")
  })

  it('redacts contact fields in both aggregate and fallback list read models', () => {
    const readModel = read('src/app/module/crm/crmListReadModel.service.ts')
    const guard = read('src/app/module/lead/leadEntitlement.service.ts')
    expect(readModel).toContain('lockedLeadRedactionStages')
    expect(readModel).toContain('LOCKED_LEAD_PHONE_MASK')
    expect(readModel).toContain('LOCKED_LEAD_EMAIL_MASK')
    expect(readModel).toContain('redactLockedLeadForList')
    expect(guard).toContain("delete redacted.contactId")
  })

  it('does not let locked phone/email values become a search side channel', () => {
    const lead = read('src/app/module/lead/lead.service.ts')
    const dashboard = read('src/app/module/dashboard/dashboard.service.ts')
    expect(lead).toContain("{$and:[{isLocked:{$ne:true}},{email:regex}]}")
    expect(lead).toContain("{$and:[{isLocked:{$ne:true}},{phone:regex}]}")
    expect(dashboard).toContain("{ isLocked: { $ne: true }, email: regex }")
    expect(dashboard).toContain("{ isLocked: { $ne: true }, phone: regex }")
  })

  it('synchronizes cumulative active capacity at request and reservation boundaries', () => {
    const guard = read('src/app/module/lead/leadEntitlement.service.ts')
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(guard).toContain('ensureCurrentLeadCapacity')
    expect(entitlement).toContain('synchronizeActiveLeadCapacityUsage')
    expect(entitlement).toContain('system:lead-capacity-boundary')
    expect(manual).toContain('maxLeads: Number(effective.limits.maxLeads || 0)')
    expect(bkash).toContain('maxLeads: Number(effective.limits.maxLeads || 0)')
  })

  it('ships a dry-run-first migration that initializes locks without mutating plans or deleting leads', () => {
    const migration = read('src/app/db/migrateLeadSubscriptionLocking.ts')
    const pkg = read('package.json')
    expect(migration).toContain("mode: cli.apply ? 'APPLY' : 'DRY-RUN'")
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('writeMigrationManifest')
    expect(migration).toContain('planMutation: false')
    expect(migration).toContain("{ $set: { isLocked: false } }")
    expect(pkg).toContain('migrate:lead-subscription-locking')
  })
})
