import mongoose from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { SubscriptionPayment } from '../module/subscriptionPayment/subscriptionPayment.model'

const apply = process.env.MIGRATION_APPLY === 'true'

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })

  try {
    const organizations: any[] = await Organization.find({
      'subscription.plan': { $ne: 'trial' },
      'subscription.currentPeriodEnd': { $type: 'date' },
      $or: [
        { 'subscription.currentPeriodStart': { $exists: false } },
        { 'subscription.currentPeriodStart': null },
      ],
    }).select('_id organizationId subscription.plan subscription.planVersion subscription.currentPeriodEnd subscription.currentPeriodStart').lean()

    let eligible = 0
    let updated = 0
    let skipped = 0

    for (const organization of organizations) {
      const currentPeriodEnd = organization.subscription?.currentPeriodEnd
      const payment: any = await SubscriptionPayment.findOne({
        organizationId: organization.organizationId,
        status: 'confirmed',
        planId: organization.subscription?.plan,
        planVersion: Number(organization.subscription?.planVersion || 1),
        periodStart: { $type: 'date' },
        periodEnd: currentPeriodEnd,
      }).sort({ confirmedAt: -1, _id: -1 }).select('periodStart periodEnd paymentNumber').lean()

      if (!payment?.periodStart) {
        skipped += 1
        continue
      }

      eligible += 1
      if (!apply) continue
      const result = await Organization.updateOne(
        {
          _id: organization._id,
          'subscription.currentPeriodEnd': currentPeriodEnd,
          $or: [
            { 'subscription.currentPeriodStart': { $exists: false } },
            { 'subscription.currentPeriodStart': null },
          ],
        },
        { $set: { 'subscription.currentPeriodStart': payment.periodStart } },
      )
      updated += result.modifiedCount
    }

    console.log(`[subscription-date-editing-phase5] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
    console.log(`[subscription-date-editing-phase5] scanned=${organizations.length} eligible=${eligible} updated=${updated} skipped_without_matching_payment=${skipped}`)
    if (!apply) console.log('[subscription-date-editing-phase5] No data changed. Re-run with MIGRATION_APPLY=true to backfill currentPeriodStart safely.')
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error('[subscription-date-editing-phase5] failed', error)
  process.exitCode = 1
})
