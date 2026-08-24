import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))
let checks = 0
const has = (file, pattern, message) => { checks += 1; assert.match(read(file), pattern, message) }

for (const legacy of [
  'src/app/module/leadTopupPricing/leadTopupPricing.model.ts',
  'src/app/module/leadPurchaseRequest/leadPurchaseRequest.model.ts',
  'src/app/module/leadTopupGrant/leadTopupGrant.model.ts',
]) { checks += 1; assert.ok(exists(legacy), `legacy top-up module must remain: ${legacy}`) }

for (const next of [
  'src/app/module/leadAddonDefinition/leadAddonDefinition.model.ts',
  'src/app/module/leadAddonSubscription/leadAddonSubscription.model.ts',
]) { checks += 1; assert.ok(exists(next), `recurring add-on module missing: ${next}`) }

has('src/app/module/subscriptionPlan/subscriptionPlan.model.ts', /maxRecurringLeadAddon/, 'plan versions need an add-on ceiling')
has('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts', /maxRecurringLeadAddon/, 'plan ceiling must be validated')
has('src/app/module/leadAddonDefinition/leadAddonDefinition.model.ts', /leadCapacity[\s\S]*priceMonthly[\s\S]*eligiblePlans[\s\S]*displayOrder[\s\S]*isActive/, 'catalog fields missing')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts', /committed \+ requested > maxRecurringLeadAddon/, 'purchase must enforce plan ceiling')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts', /remainingSeconds[\s\S]*totalSeconds[\s\S]*remainingFraction/, 'initial add-on must use timestamp proration')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts', /cancel_at_period_end/, 'add-on cancellation must defer to period end')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts', /reconcileLeadCapacity/, 'capacity activation/removal must reconcile locked leads')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.model.ts', /partialFilterExpression:\s*\{ status: 'pending_payment' \}/, 'pending requests need a concurrency guard')
has('src/app/module/entitlement/entitlement.service.ts', /topupLeadAllowance[\s\S]*recurringLeadAllowance/, 'effective lead capacity must include legacy and recurring capacity separately')
has('src/app/module/subscription/subscriptionQuote.service.ts', /targetPrice \+ renewingRecurringAddons\.recurringAddonCyclePrice/, 'renewal/downgrade quote must include recurring add-ons')
has('src/app/module/subscription/subscriptionQuote.service.ts', /renewingRecurringAddonCapacity/, 'quote snapshot must distinguish current vs renewing add-ons')
has('src/app/module/subscriptionPayment/subscriptionPayment.service.ts', /renewForSubscriptionPeriod/, 'manual payment renewal must renew add-ons')
has('src/app/module/bkashPayment/bkashPayment.service.ts', /renewForSubscriptionPeriod/, 'bKash renewal must renew add-ons')
has('src/app/module/subscriptionPayment/subscriptionPayment.service.ts', /assertRecurringAddonSnapshotApplicable/, 'manual payment must reject stale recurring snapshots')
has('src/app/module/bkashPayment/bkashPayment.service.ts', /assertRecurringAddonSnapshotApplicable/, 'bKash must reject stale recurring snapshots')
has('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts', /row\.planId = targetPlanId; row\.planVersion = targetPlanVersion/, 'renewed add-on must follow the paid target plan version')
has('src/app/routes/index.ts', /lead-addon-definitions/, 'recurring definition route must be mounted')
has('src/app/routes/index.ts', /lead-addons/, 'recurring subscription route must be mounted')
has('src/app/db/migrateRecurringLeadAddons.ts', /tenantPlanAssignmentsModified:\s*false/, 'migration must preserve assigned tenant plan versions')
has('src/app/db/migrateRecurringLeadAddons.ts', /\$set:\s*\{ maxRecurringLeadAddon: 0 \}/, 'historical plan backfill must fail closed at zero')

for (const file of ['src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts','src/app/module/leadAddonDefinition/leadAddonDefinition.service.ts']) {
  checks += 1
  assert.doesNotMatch(read(file), /Lead\.delete|Lead\.deleteMany|Lead\.remove/, `${file} must never delete leads`)
}

console.log(`Recurring lead add-on source contract passed ${checks}/${checks}`)
