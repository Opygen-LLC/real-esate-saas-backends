import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('deferred subscription downgrade contract', () => {
  it('persists an immutable scheduled target without replacing the active plan early', () => {
    const organization = read('src/app/module/organization/organization.model.ts')
    const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
    for (const fragment of [
      'scheduledPlan',
      'scheduledPlanVersion',
      'scheduledBillingCycle',
      'scheduledEffectiveAt',
      'scheduledChangeRequestId',
      'scheduledBy',
      'revision',
    ]) expect(organization).toContain(fragment)
    expect(schedule).toContain('scheduleDowngradeOnOrganization')
    expect(schedule).toContain('The currently active plan/limits are intentionally left untouched until effectiveAt')
  })

  it('supports scheduled and applied request states and classifies lower tiers as downgrades', () => {
    const model = read('src/app/module/subscriptionChangeRequest/subscriptionChangeRequest.model.ts')
    const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
    expect(model).toContain("'scheduled'")
    expect(model).toContain("'applied'")
    expect(model).toContain("['upgrade', 'downgrade', 'version_change']")
    expect(schedule).toContain('planRank')
    expect(schedule).toContain('upgradeRank')
    expect(schedule).toContain("return 'version_change'")
    expect(schedule).toContain("requestedRank < currentRank ? 'downgrade' : 'upgrade'")
  })

  it('confirms manual downgrade payment now but defers entitlement reconciliation until the boundary', () => {
    const payment = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    expect(payment).toContain("const deferredDowngrade = changeType === 'downgrade'")
    expect(payment).toContain('scheduleDowngradeOnOrganization')
    expect(payment).toContain("request.status = deferredDowngrade ? 'scheduled' : 'approved'")
    expect(payment).toContain('let entitlementReconciliation')
    expect(payment).toContain('createForPaidSubscription')
    expect(payment).toContain('periodStart: start')
  })

  it('uses the same deferred lifecycle for bKash downgrades', () => {
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(bkash).toContain("deferredDowngrade = changeType === 'downgrade'")
    expect(bkash).toContain('SubscriptionScheduleService.scheduleDowngradeOnOrganization')
    expect(bkash).toContain("source: 'bkash'")
    expect(bkash).toContain("eventType: 'subscription.downgrade_scheduled'")
  })

  it('applies schedules transactionally and idempotently with an optimistic subscription revision', () => {
    const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
    expect(schedule).toContain('withTransaction')
    expect(schedule).toContain("'subscription.revision': expectedRevision")
    expect(schedule).toContain("$inc: { 'subscription.revision': 1 }")
    expect(schedule).toContain("'subscription.scheduledEffectiveAt': { $lte: now }")
    expect(schedule).toContain("request.status = 'applied'")
    expect(schedule).toContain('reconcileOrganizationEntitlements')
    expect(schedule).toContain('publishSubscriptionEntitlementReconciliation')
  })

  it('has both worker and request-time protection for the exact effective boundary', () => {
    const worker = read('src/app/module/cron/phase3.worker.ts')
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    expect(worker).toContain('SubscriptionScheduleService.processDueChanges')
    expect(lifecycle).toContain('SubscriptionScheduleService.processDueChanges')
    expect(lifecycle).toContain('SubscriptionScheduleService.applyDueChange')
  })


  it('exposes current and scheduled subscription state without changing the current plan contract', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    for (const fragment of [
      'currentPlan:',
      'scheduledPlan,',
      'scheduledPlanVersion,',
      'scheduledBillingCycle,',
      'scheduledEffectiveAt,',
      'scheduledChangeRequestId,',
      'changeType,',
    ]) expect(billing).toContain(fragment)
  })
  it('blocks cancellation or administrative override of an already-paid scheduled downgrade without a billing adjustment workflow', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    const platformAdmin = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    expect(billing).toContain('A paid downgrade is already scheduled')
    expect(platformAdmin).toContain('Resolve its billing adjustment/refund')
    expect(manual).toContain('Only requests waiting for payment can be cancelled')
  })

  it('ships an explicit production migration for schedule indexes and legacy request classification', () => {
    const migration = read('src/app/db/migrateDeferredSubscriptionSchedules.ts')
    const pkg = read('package.json')
    expect(migration).toContain('subscription_due_schedule')
    expect(migration).toContain("requests.createIndex({ changeType: 1 }")
    expect(migration).toContain('requestsChangeTypeBackfilled')
    expect(migration).toContain('planVersionMutation: false')
    expect(pkg).toContain('migrate:subscription-deferred-downgrades')
  })

})
