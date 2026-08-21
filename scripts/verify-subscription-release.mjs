import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const required = (source, fragment, label) => {
  if (!source.includes(fragment)) throw new Error(`[subscription-release] missing ${label}: ${fragment}`)
}
const forbidden = (source, fragment, label) => {
  if (source.includes(fragment)) throw new Error(`[subscription-release] forbidden ${label}: ${fragment}`)
}

const migration = read('src/app/db/migrateSubscriptionLeadReleaseV1.ts')
const rollover = read('src/app/db/migrateSubscriptionTierRolloverV2.ts')
const benefit = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
const leadEntitlement = read('src/app/module/lead/leadEntitlement.service.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const activityService = read('src/app/module/activity/activity.service.ts')
const crmReadModel = read('src/app/module/crm/crmListReadModel.service.ts')
const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
const packageJson = read('package.json')

for (const fragment of [
  "planId: 'starter', version: 6", 'priceMonthly: 500', 'priceYearly: 5000', 'baseLeadCapacity: 200', 'renewalLeadBonus: 50',
  "planId: 'professional', version: 4", 'priceMonthly: 1000', 'priceYearly: 10000', 'baseLeadCapacity: 800', 'renewalLeadBonus: 100',
  "planId: 'agency', version: 4", 'priceMonthly: 1500', 'priceYearly: 15000', 'baseLeadCapacity: 2000', 'renewalLeadBonus: 200',
  "leadAllowanceModel: 'active_capacity'", 'maxRenewalLeadBonus: 0', 'grandfatherExisting: true',
]) required(migration, fragment, 'release catalog policy')

for (const fragment of [
  'assignmentFingerprint',
  'tenantPlanVersionMutation: false',
  'historicalVersionsRemainActive: true',
  'leadCountBefore',
  'leadCountAfter',
  'Grandfathered tenant Leads remain subscription-locked',
  'isLocked: false',
  'lead_tenant_lock_created',
  "mode: cli.apply ? 'APPLY' : 'DRY-RUN'",
  'backupDocuments',
  'writeMigrationManifest',
]) required(migration, fragment, 'release migration safety')
forbidden(migration, 'Organization.updateMany(', 'tenant assignment bulk mutation')
required(migration, 'tenantPlanVersionMutation: false', 'tenant planVersion mutation declaration')

required(rollover, 'Organization.subscription plan/version assignment fingerprint changed during migration', 'phase-1 grandfathering invariant')
required(benefit, 'Math.max(0, renewalStreak - 1) * renewalLeadBonus', 'cumulative renewal formula')
required(benefit, 'maxRenewalLeadBonus === 0 ? uncappedBonus : Math.min(uncappedBonus, maxRenewalLeadBonus)', 'unlimited sentinel and historical positive cap compatibility')
required(benefit, "leadAllowanceModel === 'active_capacity'", 'active-capacity policy')
required(schedule, "'subscription.revision': expectedRevision", 'scheduled downgrade optimistic revision')
required(schedule, 'withTransaction', 'scheduled downgrade transaction')
required(schedule, 'reconcileOrganizationEntitlements', 'atomic entitlement reconciliation')
required(schedule, 'publishSubscriptionEntitlementReconciliation', 'post-commit reconciliation publish')
required(schedule, "type: 'subscription.changed'", 'realtime subscription event')
required(schedule, 'CacheInvalidationService.invalidateTenant', 'subscription cache invalidation')
required(leadEntitlement, '.sort({ createdAt: -1, _id: -1 })', 'newest-first lead access selection')
required(leadEntitlement, "lockReason: LEAD_SUBSCRIPTION_LOCK_REASON", 'persistent subscription lock')
required(leadEntitlement, "'PLAN_UPGRADE_REQUIRED'", 'locked-lead upgrade error')
required(leadEntitlement, 'LOCKED_LEAD_PHONE_MASK', 'phone redaction')
required(leadEntitlement, 'LOCKED_LEAD_EMAIL_MASK', 'email redaction')
if ((leadService.match(/assertLeadAccessible/g) || []).length < 9) throw new Error('[subscription-release] LeadService guard coverage regressed')
if ((activityService.match(/assertLeadAccessible/g) || []).length < 4) throw new Error('[subscription-release] Activity lead guard coverage regressed')
required(leadService, 'assertExportContainsNoLockedLeads', 'CSV/XLSX all-or-nothing guard')
required(crmReadModel, 'LOCKED_LEAD_PHONE_MASK', 'aggregate list phone redaction')
required(crmReadModel, 'LOCKED_LEAD_EMAIL_MASK', 'aggregate list email redaction')
required(entitlement, 'withLeadQuotaGuard', 'serialized lead capacity reservations')
required(entitlement, "{ $inc: { leadQuotaRevision: 1 } }", 'tenant lead quota mutex')
required(packageJson, 'migrate:subscription-release', 'release migration package command')
required(packageJson, 'test:subscription-release', 'release test package command')
required(packageJson, 'verify:subscription-release', 'release verification package command')

console.log('[subscription-release] source invariants verified')
