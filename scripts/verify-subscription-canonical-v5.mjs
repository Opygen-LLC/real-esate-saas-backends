import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const required = (source, fragment, label) => {
  if (!source.includes(fragment)) throw new Error(`[subscription-canonical-v5] missing ${label}: ${fragment}`)
}
const forbiddenPattern = (source, pattern, label) => {
  if (pattern.test(source)) throw new Error(`[subscription-canonical-v5] forbidden ${label}: ${pattern}`)
}

const migration = read('src/app/db/migrateSubscriptionCanonicalModelV5.ts')
const catalog = read('src/app/module/subscriptionPlan/subscriptionPlan.catalog.ts')
const canonicalWrite = read('src/app/module/subscriptionPlan/planCanonicalWrite.ts')
const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
const benefitModel = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model.ts')
const benefitService = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')

for (const fragment of [
  'CURRENT_PLAN_CATALOG',
  'baseLeadCapacity: 200', 'maxAddonLeadCapacity: 2_000',
  'baseLeadCapacity: 800', 'maxAddonLeadCapacity: 5_000',
  'baseLeadCapacity: 2_000', 'maxAddonLeadCapacity: 20_000',
]) required(catalog, fragment, 'authoritative catalog')

required(service, 'CURRENT_PLAN_CATALOG_ROWS', 'catalog bootstrap')
required(service, 'applyCanonicalPlanWrite', 'canonical plan write path')
for (const fragment of ['delete next.maxLeads', 'delete next.maxRecurringLeadAddon']) required(canonicalWrite, fragment, 'legacy plan write stripping')
for (const fragment of [
  'maxLeads: z.never().optional()',
  'baseMonthlyLeadAllowance: z.never().optional()',
  'renewalLeadBonus: z.never().optional()',
  'renewalBonusEnabled: z.never().optional()',
  'maxRenewalLeadBonus: z.never().optional()',
  'continuityGraceDays: z.never().optional()',
  'leadAllowanceModel: z.never().optional()',
  'maxRecurringLeadAddon: z.never().optional()',
  'leads: z.never().optional()',
]) required(validation, fragment, 'legacy write rejection')

for (const fragment of ['ledgerVersion', 'baseLeadCapacity', 'recurringAddonCapacity', 'effectiveLeadCapacity']) {
  required(benefitModel, fragment, 'benefit ledger canonical field')
  required(benefitService, fragment, 'benefit ledger canonical write')
}

for (const fragment of [
  'tenantAssignmentMutation: false',
  'historicalBenefitPeriodMutation: false',
  'historicalPaymentMutation: false',
  'historicalCommercialFieldMutation: false',
  'integrityBefore',
  'integrityAfter',
  "status: 'grandfathered'",
  "status: 'current'",
]) required(migration, fragment, 'migration safety')
forbiddenPattern(migration, /organizations\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/, 'tenant mutation')
forbiddenPattern(migration, /benefitPeriods\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/, 'historical benefit mutation')
forbiddenPattern(migration, /payments\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/, 'historical payment mutation')

console.log('[subscription-canonical-v5] source invariants verified')
