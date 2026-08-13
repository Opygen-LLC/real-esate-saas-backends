import { sendSms } from '../../helpers/sendOtp'
import { writeAudit } from '../audit/audit.service'
import { BkashPayment } from '../bkashPayment/bkashPayment.model'
import { BkashPaymentService } from '../bkashPayment/bkashPayment.service'
import { Organization } from '../organization/organization.model'

const GRACE_MS = 3 * 24 * 60 * 60 * 1000
const REMINDER_MS = 3 * 24 * 60 * 60 * 1000

export const reconcileSubscriptions = async (): Promise<{ transitioned: number; reminders: number; stalePayments: number }> => {
  const now = new Date()
  const pendingAttempts = await BkashPayment.find({ paymentId: { $ne: '' }, status: { $in: ['pending', 'failed'] },
    updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }).select('paymentId').limit(100)
  for (const attempt of pendingAttempts) {
    try { await BkashPaymentService.reconcilePaymentAttempt(attempt.paymentId || '') } catch { /* retry on the next scheduler run */ }
  }
  const stale = await BkashPayment.updateMany({ status: { $in: ['initialized', 'pending', 'executing'] }, updatedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } },
    { status: 'failed', gatewayStatusMessage: 'Payment attempt expired during reconciliation' })
  const organizations = await Organization.find({ 'subscription.status': { $in: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end'] } })
  let transitioned = 0; let reminders = 0
  for (const org of organizations) {
    const subscription = org.subscription
    const periodEnd = subscription.currentPeriodEnd
    let nextStatus: typeof subscription.status | null = null
    if (subscription.status === 'grace' && subscription.gracePeriodEnd && subscription.gracePeriodEnd <= now) nextStatus = 'expired'
    else if (['trialing', 'active', 'past_due'].includes(subscription.status) && periodEnd && periodEnd <= now) {
      nextStatus = 'grace'; subscription.gracePeriodEnd = new Date(now.getTime() + GRACE_MS)
    } else if (subscription.status === 'cancel_at_period_end' && periodEnd && periodEnd <= now) nextStatus = 'expired'
    if (nextStatus && nextStatus !== subscription.status) {
      const previous = subscription.status; subscription.status = nextStatus; await org.save(); transitioned += 1
      await writeAudit({ organizationId: org.organizationId, action: 'subscription.status_changed', entityType: 'organization',
        entityId: org._id.toString(), metadata: { previous, next: nextStatus } })
      continue
    }
    if (periodEnd && periodEnd.getTime() - now.getTime() > 0 && periodEnd.getTime() - now.getTime() <= REMINDER_MS &&
        (!subscription.reminderSentAt || subscription.reminderSentAt < new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000))) {
      await sendSms(org.phone, `Your ${org.agencyName} subscription expires on ${periodEnd.toLocaleDateString('en-BD')}. Renew with bKash to avoid interruption.`)
      subscription.reminderSentAt = now; await org.save(); reminders += 1
    }
  }
  return { transitioned, reminders, stalePayments: stale.modifiedCount }
}
