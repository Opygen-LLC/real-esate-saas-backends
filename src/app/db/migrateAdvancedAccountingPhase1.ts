import mongoose from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { PlatformSettings } from '../module/platformSettings/platformSettings.model'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'

const run = async () => {
  await mongoose.connect(config.database_string as string)
  const enabledPlans = ['agency', 'enterprise']
  await SubscriptionPlan.updateMany(
    { planId: { $in: enabledPlans } },
    { $set: { hasAdvancedAccounting: true, 'entitlements.advancedAccounting': { enabled: true } } },
  )
  await SubscriptionPlan.updateMany(
    { planId: { $nin: enabledPlans } },
    { $set: { hasAdvancedAccounting: false, 'entitlements.advancedAccounting': { enabled: false } } },
  )
  await PlatformSettings.updateOne(
    { key: 'platform' },
    { $set: { 'trial.hasAdvancedAccounting': false, 'trial.entitlements.advancedAccounting': { enabled: false } } },
    { upsert: true },
  )
  await FinanceAccountingSettings.syncIndexes()
  await Promise.all([Cache.plans.del('catalog'), Cache.platformSettings.del('trial-policy')])
  console.log('Advanced Accounting Phase 1 migration completed. Agency Scale/Enterprise enabled; lower plans and trial disabled.')
  await mongoose.disconnect()
}

run().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => undefined); process.exit(1) })
