import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(`Phase 4 release verification failed: ${message}`) }
const requireFile = (relative) => {
  const absolute = path.join(root, relative)
  assert(fs.existsSync(absolute), `missing ${relative}`)
  return fs.readFileSync(absolute, 'utf8')
}

const pkg = JSON.parse(read('package.json'))
for (const script of ['test:phase4-release:source', 'test:phase4-release:unit', 'test:phase4-release:integration', 'gate:phase4-release', 'gate:phase4-release:ci']) {
  assert(Boolean(pkg.scripts?.[script]), `package.json is missing ${script}`)
}
assert(pkg.scripts['test:phase4-release:integration'].includes('TEST_DATABASE_URL'), 'integration suite must require a real database URL')
assert(pkg.scripts['test:phase4-release:integration'].includes('--fileParallelism=false'), 'database release suites must run serially')

for (const relative of ['Dockerfile', 'docker-compose.production.yml']) {
  assert(read(relative).includes('/ready'), `${relative} must use /ready for deployment health`)
}
const composeCi = read('docker-compose.ci.yml')
assert(composeCi.includes('--replSet'), 'CI MongoDB must run as a replica set')
assert(composeCi.includes('rs.initiate'), 'CI must initialize the MongoDB replica set')

const integration = requireFile('src/tests/integration/phase4Release.integration.test.ts')
for (const invariant of [
  "TEST_DATABASE_URL must be a replica set or mongos",
  "status: 'ready'",
  "taxCodeId: null",
  "VAT15",
  "lineItems.0.quantity",
  "Discount cannot exceed subtotal",
  "Due date cannot be before the issue date",
  "This property does not belong to your organization.",
  "FINANCE_ACCOUNT_MAPPING_REQUIRED",
  "INVOICE_IDEMPOTENCY_KEY_REUSED",
  "forced phase4 audit failure",
  "forced phase4 outbox failure",
  "Hidden banner",
  "Hidden section",
  "Hidden page",
]) assert(integration.includes(invariant), `database release regression is missing ${invariant}`)

const events = read('src/shared/productionEvents.ts')
const handler = read('src/app/middlewares/globalErrorHandler.ts')
const classifier = requireFile('src/shared/invoiceFailureTelemetry.ts')
assert(events.includes("'invoice_request_failed'"), 'invoice failure production event is missing')
assert(handler.includes("emitProductionEvent('invoice_request_failed'"), 'global error handler must emit invoice failure telemetry')
assert(handler.includes('classifyInvoiceFailure(statusCode, code)'), 'invoice failure telemetry must be classified')
for (const classification of ['validation', 'transactions_required', 'accounting_configuration', 'idempotency_conflict', 'unexpected']) {
  assert(classifier.includes(`'${classification}'`), `missing invoice failure class ${classification}`)
}
const invoiceBlockStart = handler.indexOf('const invoiceWriteFailure')
const invoiceBlockEnd = handler.indexOf("if (route.includes('/website/studio/publish')", invoiceBlockStart)
const invoiceBlock = handler.slice(invoiceBlockStart, invoiceBlockEnd)
for (const pii of ['clientName', 'clientEmail', 'clientPhone', 'notes', 'reference', 'lineItems']) {
  assert(!invoiceBlock.includes(pii), `invoice telemetry must not log ${pii}`)
}
assert(invoiceBlock.includes('Object.keys(fieldErrors)'), 'validation telemetry should include field names only')
assert(handler.includes("emitProductionEvent('form_validation_failed'"), 'existing field-validation telemetry must remain')
assert(handler.includes('requestId: req.requestId'), 'requestId correlation must remain')

const unit = requireFile('src/tests/unit/phase4InvoiceFailureTelemetry.unit.test.ts')
assert(unit.includes('TRANSACTIONS_REQUIRED'), 'telemetry unit regression must cover transaction topology')
assert(unit.includes('FINANCE_ACCOUNT_MAPPING_REQUIRED'), 'telemetry unit regression must cover account mappings')

const httpSecurity = requireFile('src/tests/security/httpSecurity.security.test.ts')
assert(/csrf/i.test(httpSecurity), 'security release suite must retain CSRF regression coverage')
const corsSecurity = requireFile('src/tests/unit/cors.unit.test.ts')
assert(/origin/i.test(corsSecurity), 'security release suite must retain trusted-origin regression coverage')
assert(httpSecurity.includes('429'), 'security release suite must retain rate-limit regression coverage')
const tenantMatrix = requireFile('src/tests/security/phase3TenantIsolationMatrix.security.test.ts')
for (const domain of ['Finance', 'Customer Finance', 'Properties', 'Suppliers', 'Materials', 'CRM']) {
  assert(tenantMatrix.includes(domain), `tenant-isolation matrix is missing ${domain}`)
}
const secretTests = requireFile('src/tests/unit/productionSecrets.unit.test.ts')
assert(/placeholder|predictable|known/i.test(secretTests), 'production secret tests must reject known/default secrets')
assert(pkg.scripts['gate:phase4-release'].includes('test:phase4-release:source'), 'release gate must run dependency-free source regressions')
assert(pkg.scripts['gate:phase4-release'].includes('test:security'), 'release gate must run security regressions')
assert(pkg.scripts['gate:phase4-release'].includes('test:unit'), 'release gate must run unit regressions')
assert(pkg.scripts['gate:phase4-release'].includes('test:contract'), 'release gate must run contract regressions')
assert(pkg.scripts['gate:phase4-release'].includes('audit --prod --audit-level=high'), 'release gate must run dependency audit')

const ci = read('.github/workflows/ci.yml')
assert(ci.includes('Phase 4 replica-set release regression'), 'CI must run Phase 4 replica-set integration regression')
assert(ci.includes('docker compose -f docker-compose.ci.yml up -d mongo'), 'CI must start MongoDB for release regression')
assert(ci.includes('mongo-init'), 'CI must initialize replica set before release regression')
assert(ci.includes('pnpm verify:phase4-release'), 'CI must enforce Phase 4 invariants')

console.log('Phase 4 backend release verification passed.')
