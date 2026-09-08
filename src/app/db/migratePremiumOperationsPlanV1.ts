import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import { resolvePlanStatus } from '../module/subscriptionPlan/planLifecycle'

const MIGRATION = 'premium-operations-plan-v1'
const PLAN_ID = 'agency'
const TARGET_MONTHLY_PRICE = 2_000
const TARGET_YEARLY_PRICE = 20_000
const PREMIUM_MARKETING_FEATURES = [
  'Customer Finance & Installments',
  'Materials & Inventory',
  'Supplier Management',
]

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const current: any = await SubscriptionPlan.findOne({ planId: PLAN_ID, isCurrent: true }).sort({ version: -1 }).lean()
  if (!current) {
    throw new Error(`Current ${PLAN_ID} plan was not found. Bootstrap the subscription catalog before running this migration.`)
  }
  if (resolvePlanStatus(current) !== 'current') throw new Error(`Plan ${PLAN_ID}@v${current.version} is not current`)

  const alreadyApplied = Number(current.priceMonthly) === TARGET_MONTHLY_PRICE
    && Number(current.priceYearly) === TARGET_YEARLY_PRICE
    && current.hasCustomerFinance === true
    && current.hasMaterialsInventory === true
    && current.hasSupplierManagement === true

  const tenantAssignments = await db.collection('organizations').countDocuments({
    'subscription.plan': PLAN_ID,
    'subscription.planVersion': Number(current.version),
  })

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    currentPlan: `${PLAN_ID}@v${current.version}`,
    currentMonthlyPrice: Number(current.priceMonthly || 0),
    targetMonthlyPrice: TARGET_MONTHLY_PRICE,
    targetYearlyPrice: TARGET_YEARLY_PRICE,
    currentPremiumFeatures: {
      customerFinance: Boolean(current.hasCustomerFinance),
      materialsInventory: Boolean(current.hasMaterialsInventory),
      supplierManagement: Boolean(current.hasSupplierManagement),
    },
    tenantsGrandfatheredOnCurrentVersion: tenantAssignments,
    tenantSubscriptionMutation: false,
    historicalPlanMutation: false,
    alreadyApplied,
  }, null, 2))

  if (!cli.apply || alreadyApplied) {
    if (!cli.apply) console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the dry-run output.`)
    else console.log(`[${MIGRATION}] Already applied; no data changed.`)
    return
  }

  const planBackup = await backupDocuments({
    collection: db.collection('subscriptionplans'),
    filter: { planId: PLAN_ID },
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  const marketingFeatures = Array.from(new Set([
    ...(Array.isArray(current.features) ? current.features.map(String) : []),
    ...PREMIUM_MARKETING_FEATURES,
  ]))

  const created = await SubscriptionPlanService.createVersion(String(current._id), {
    priceMonthly: TARGET_MONTHLY_PRICE,
    priceYearly: TARGET_YEARLY_PRICE,
    features: marketingFeatures,
    hasCustomerFinance: true,
    hasMaterialsInventory: true,
    hasSupplierManagement: true,
    changeReason: 'Introduce the BDT 2,000 premium operations tier with customer finance, materials inventory, and supplier management entitlements',
  }, 'system:premium-operations-plan-v1')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    previousCurrentVersion: Number(current.version),
    createdCurrentVersion: Number((created as any).version),
    tenantsGrandfatheredOnPreviousVersion: tenantAssignments,
    tenantSubscriptionMutation: false,
    historicalPlanMutation: false,
    premiumEntitlements: ['customer_finance', 'materials_inventory', 'supplier_management'],
  })

  console.log(`[${MIGRATION}] completed created=${PLAN_ID}@v${(created as any).version} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
