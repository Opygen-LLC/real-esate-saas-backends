import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const productionEvents = read('src/shared/productionEvents.ts')
const globalErrors = read('src/app/middlewares/globalErrorHandler.ts')
const finance = read('src/app/module/finance/finance.service.ts')
const financeModel = read('src/app/module/finance/finance.model.ts')
const submissions = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const meta = read('src/app/module/metaIntegration/metaIntegration.service.ts')
const organization = read('src/app/module/organization/organization.service.ts')
const observability = read('src/app/module/observability/observability.service.ts')
const observabilityRoute = read('src/app/module/observability/observability.route.ts')
const migration = read('src/app/db/migratePhase5FinalHardening.ts')

const requiredEvents = [
  'invoice_created',
  'invoice_property_linked',
  'invoice_calculation_rejected',
  'invoice_payment_recorded',
  'form_validation_failed',
  'website_submission_received',
  'website_submission_moved_to_crm',
  'website_submission_crm_merged',
  'website_submission_crm_failed',
  'meta_pixel_configured',
  'meta_capi_configured',
  'meta_capi_failed',
  'website_template_changed',
  'website_template_render_failed',
]
for (const event of requiredEvents) assert.match(productionEvents, new RegExp(`'${event}'`), `missing production event ${event}`)

assert.match(globalErrors, /code === API_ERROR_CODES\.VALIDATION_ERROR/)
assert.match(globalErrors, /fields: Object\.keys\(fieldErrors\)/)
assert.match(finance, /emitProductionEvent\('invoice_created'/)
assert.match(finance, /emitProductionEvent\('invoice_property_linked'/)
assert.match(finance, /emitProductionEvent\('invoice_calculation_rejected'/)
assert.match(finance, /emitProductionEvent\('invoice_payment_recorded'/)
assert.match(financeModel, /organizationId: 1, propertyId: 1, createdAt: -1/)

assert.match(submissions, /website_submission_received/)
assert.match(submissions, /website_submission_moved_to_crm/)
assert.match(submissions, /website_submission_crm_merged/)
assert.match(submissions, /website_submission_crm_failed/)
assert.match(submissions, /crmTransferStatus: 'PROCESSING'/)
assert.match(submissions, /CRM_TRANSFER_STALE_AFTER_MS/)
assert.match(submissions, /createLeadWithOutcome/)

assert.match(meta, /meta_pixel_configured/)
assert.match(meta, /meta_capi_configured/)
assert.match(meta, /meta_capi_failed/)
assert.match(meta, /resolveCanonicalMetaPublicUrl/)
assert.match(meta, /eventId/)
assert.doesNotMatch(meta, /emitProductionEvent\([^\n]+(?:rawToken|accessTokenEncrypted|decryptField)/i)

assert.match(organization, /website_template_changed/)
assert.match(organization, /CacheInvalidationService\.invalidateTenant\(organizationId\)/)
assert.match(observabilityRoute, /operational-event/)
assert.match(observability, /website_template_render_failed/)
assert.match(observability, /sanitizeFieldName/)

assert.match(migration, /DRY-RUN/)
assert.match(migration, /--apply/)
assert.match(migration, /crmTransferStatus/)
assert.match(migration, /capiStatus/)
assert.match(migration, /finance_invoice_tenant_property_created/)
assert.match(migration, /invalidTemplateRows/)

console.log(`Phase 5 final hardening verification passed: ${requiredEvents.length} structured events + migration/regression invariants.`)
