import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const requireText = (relative, needles) => {
  const source = read(relative)
  for (const needle of needles) {
    if (!source.includes(needle)) throw new Error(`${relative} is missing required Phase 5 contract: ${needle}`)
  }
  return source
}
const forbidText = (relative, needles) => {
  const source = read(relative)
  for (const needle of needles) {
    if (source.includes(needle)) throw new Error(`${relative} contains forbidden Phase 5 coupling: ${needle}`)
  }
  return source
}

const migration = requireText('src/app/db/migrateTenantAccessPhase5.ts', [
  'subscriptionFingerprint',
  'subscriptionAssignmentMutation: false',
  'subscriptionStatusMutation: false',
  'subscriptionDateMutation: false',
  'dataDeletion: false',
  "fieldsEligibleForBackfill: ['platformAccess.status', 'websiteStatus']",
  "set.websiteStatus = 'provisioned'",
])
for (const destructive of ['deleteMany(', 'deleteOne(', 'dropCollection(', 'dropDatabase(']) {
  if (migration.includes(destructive)) throw new Error(`Tenant access migration must not contain ${destructive}`)
}

requireText('src/app/module/tenantAccess/tenantAccessMonitoring.service.ts', [
  'tenant_access_locked_total',
  'tenant_access_lock_reason',
  'subscription_reactivation_total',
  'public_site_access_denied_total',
])
requireText('src/app/module/subscription/subscriptionLifecycle.service.ts', [
  'subscription_expiry_transition_total',
  'TenantAccessTransitionService.sync',
])
requireText('src/app/module/cron/phase3.worker.ts', [
  'subscription_lifecycle_last_success_timestamp',
  'subscription_lifecycle_last_success_timestamp_seconds',
  'subscription_lifecycle_failures_total',
  'TenantAccessMonitoringService.refreshLockReasonGauges',
])
requireText('src/app/module/platformAdmin/platformAdmin.tenant360.service.ts', [
  'effectiveAccess',
  'renewalRequired',
  'websiteConfigurationPreserved',
  'TenantAccessService.isSubscriptionAccessible',
])
requireText('src/app/module/subscriptionPayment/subscriptionPayment.service.ts', [
  'Billing lifecycle and platform suspension are deliberately independent',
  'previousSubscriptionStatus',
  "status: 'active'",
])

for (const relative of [
  'src/app/module/platformAdmin/platformAdmin.service.ts',
  'src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts',
  'src/app/module/user/user.service.ts',
]) {
  forbidText(relative, ["org.websiteStatus = 'suspended'", "org.subscription.status = 'suspended'"])
  requireText(relative, ["org.websiteStatus === 'suspended'", "org.subscription?.status === 'suspended'"])
}

const payment = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
if (payment.includes('Reactivate this tenant before confirming a subscription payment')) {
  throw new Error('Manual payment confirmation still blocks platform-suspended tenant renewal')
}

const integration = requireText('src/tests/integration/tenantAccessLifecycle.integration.test.ts', [
  'TRIAL_EXPIRED',
  'SUBSCRIPTION_EXPIRED',
  'PLATFORM_SUSPENDED',
  'WEBSITE_NOT_PUBLISHED',
  'phase5PreservationProbe',
  '/api/v1/lead/public-capture',
  '/api/v1/viewing/public-request',
  '/sitemap.xml',
  '/robots.txt',
  '/share-card/',
  '/api/v1/domain/resolve-subdomain/',
  '/api/v1/domain/resolve/',
])
if (!integration.includes('await assertPreserved()')) throw new Error('Phase 5 lifecycle integration test is missing data-preservation assertions')

console.log('Tenant access Phase 5 production verification passed.')
