import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const requireFile = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Phase 5 release gate is missing ${file}`)
  return read(file)
}

const pkg = JSON.parse(requireFile('package.json'))
const requiredScripts = [
  'reconcile:phase5-false-failures',
  'test:phase5-production',
  'verify:phase5-production',
  'smoke:phase5-staging',
  'monitor:phase5-production',
  'verify:release',
]
for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) throw new Error(`package.json is missing Phase 5 script: ${script}`)
}

const reconcile = requireFile('src/app/db/reconcilePhase5FalseFailures.ts')
for (const invariant of [
  'PHASE5-FALSE-FAILURE-REPAIR',
  'replaysRequests: false',
  'mutatesExistingViewing: false',
  'mutatesExistingLead: false',
  'mutatesSubscription: false',
  'publishesExternalSideEffects: false',
  'additiveRepairsOnly: true',
  'completed_viewing_lead_lifecycle_mismatch',
  'Audit row exists, so the old false-500 request may already have committed',
]) {
  if (!reconcile.includes(invariant)) throw new Error(`Reconciliation safety invariant missing: ${invariant}`)
}

const crm = requireFile('src/app/module/crm/crmListReadModel.service.ts')
const leadReadStart = crm.indexOf('export const readLeadListPage')
const leadReadEnd = crm.indexOf('export const readContactListPage', leadReadStart)
const leadRead = crm.slice(leadReadStart, leadReadEnd)
if (leadRead.includes('$facet')) throw new Error('Lead production read model must not use $facet around lookup hydration')
if (!leadRead.includes('Promise.all')) throw new Error('Lead production read model must count and hydrate concurrently')
if (!leadRead.includes('crm_read_model_fallback_total')) throw new Error('CRM fallback metric is missing')

const viewing = requireFile('src/app/module/viewing/viewing.service.ts')
if (!viewing.includes('viewing_update_internal_failures_total')) throw new Error('Viewing internal-failure metric is missing')
if (!viewing.includes("payload.status==='Completed'?'viewing.completed':'viewing.updated'")) throw new Error('Viewing completed-event contract is missing')

const domainEvents = requireFile('src/app/module/domainEvent/domainEvent.service.ts')
if (!domainEvents.includes('domain_event_failures_total')) throw new Error('Domain-event failure metric is missing')

const revalidation = requireFile('src/app/module/realtime/nextRevalidation.service.ts')
if (!revalidation.includes('next_revalidation_failures_total')) throw new Error('Next revalidation failure metric is missing')

const quota = requireFile('src/app/module/entitlement/entitlement.service.ts')
if (!quota.includes('team_quota_transaction_failures_total')) throw new Error('Team quota transaction failure metric is missing')
if (!quota.includes('let completed = false')) throw new Error('Team quota void-callback completion guard is missing')

for (const file of [
  'src/tests/contract/phase5ProductionRelease.contract.test.ts',
  'src/tests/integration/phase5ProductionRegression.integration.test.ts',
  'scripts/phase5-staging-smoke.mjs',
  'scripts/phase5-production-watch.mjs',
  'ops/PHASE5_PRODUCTION_RELEASE_RUNBOOK.md',
]) requireFile(file)

console.log('Phase 5 backend production release invariants passed.')
