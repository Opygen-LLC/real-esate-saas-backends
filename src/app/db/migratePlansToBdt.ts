import mongoose from 'mongoose'
import config from '../../config'

const TARGET_PRICES: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 500, yearly: 5000 },
  professional: { monthly: 3490, yearly: 34900 },
  agency: { monthly: 6990, yearly: 69900 },
  enterprise: { monthly: 12990, yearly: 129900 },
}

const LEGACY_PLAN_IDS: Record<string, string> = { growth: 'professional' }

const run = async () => {
  await mongoose.connect(config.database_string, { autoIndex: false })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const plans = db.collection('subscriptionplans')
  const organizations = db.collection('organizations')
  const billings = db.collection('billings')
  const payments = db.collection('bkashpayments')

  const rows = await plans.find({}).toArray()
  for (const row of rows) {
    const rawPlanId = String(row.planId || '').toLowerCase()
    const planId = LEGACY_PLAN_IDS[rawPlanId] || rawPlanId
    const target = TARGET_PRICES[planId]
    if (!target) continue

    if (rawPlanId !== planId) {
      const collision = await plans.findOne({ planId, _id: { $ne: row._id } })
      if (collision) throw new Error(`Cannot rename legacy plan ${rawPlanId} to ${planId}: both plan families exist. Resolve the duplicate catalog before applying the migration.`)
    }

    const looksLegacy = String(row.currency || '').toUpperCase() !== 'BDT' || Number(row.priceMonthly || 0) < 500
    const set: Record<string, unknown> = { planId, currency: 'BDT' }
    if (looksLegacy) {
      set.priceMonthly = target.monthly
      set.priceYearly = target.yearly
      set.bdtPriceMigratedAt = row.bdtPriceMigratedAt || new Date()
    }
    await plans.updateOne({ _id: row._id }, { $set: set })
  }

  for (const [legacy, current] of Object.entries(LEGACY_PLAN_IDS)) {
    await Promise.all([
      organizations.updateMany({ 'subscription.plan': legacy }, { $set: { 'subscription.plan': current } }),
      organizations.updateMany({ subscriptionPlan: legacy }, { $set: { subscriptionPlan: current } }),
      billings.updateMany({ plan: legacy }, { $set: { plan: current } }),
      payments.updateMany({ planId: legacy }, { $set: { planId: current } }),
    ])
  }

  console.log(`BDT plan migration completed: ${rows.length} plan rows inspected.`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
