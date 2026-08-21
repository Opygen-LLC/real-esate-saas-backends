import { sendSms } from '../../helpers/sendOtp'
import { writeAudit } from '../audit/audit.service'
import { Organization } from '../organization/organization.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { SubscriptionScheduleService } from './subscriptionSchedule.service'

export const reconcileSubscriptions = async (): Promise<{ transitioned: number; reminders: number; scheduledChanges: Awaited<ReturnType<typeof SubscriptionScheduleService.processDueChanges>> }> => {
  const now = new Date()
  // Apply paid deferred downgrades before expiry/grace logic sees the old period boundary.
  const scheduledChanges = await SubscriptionScheduleService.processDueChanges(100, now)
  const trialPolicy = await getTrialPolicy()
  const graceMs = trialPolicy.gracePeriodDays * 24 * 60 * 60 * 1000
  const reminderMs = trialPolicy.reminderDaysBeforeExpiry * 24 * 60 * 60 * 1000
  const organizations = await Organization.find({ 'subscription.status': { $in: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end'] } })
  let transitioned = 0; let reminders = 0
  for (const org of organizations) {
    const subscription = org.subscription
    const periodEnd = subscription.currentPeriodEnd
    let nextStatus: typeof subscription.status | null = null
    if (subscription.status === 'grace' && subscription.gracePeriodEnd && subscription.gracePeriodEnd <= now) nextStatus = 'expired'
    else if (['trialing', 'active', 'past_due'].includes(subscription.status) && periodEnd && periodEnd <= now) {
      if (graceMs <= 0) { nextStatus = 'expired'; subscription.gracePeriodEnd = undefined }
      else { nextStatus = 'grace'; subscription.gracePeriodEnd = new Date(now.getTime() + graceMs) }
    } else if (subscription.status === 'cancel_at_period_end' && periodEnd && periodEnd <= now) nextStatus = 'expired'
    if (nextStatus && nextStatus !== subscription.status) {
      const previous = subscription.status; subscription.status = nextStatus; await org.save(); transitioned += 1
      await writeAudit({ organizationId: org.organizationId, action: 'subscription.status_changed', entityType: 'organization', entityId: org._id.toString(), metadata: { previous, next: nextStatus } })
      continue
    }
    if (periodEnd && periodEnd.getTime() - now.getTime() > 0 && periodEnd.getTime() - now.getTime() <= reminderMs &&
        (!subscription.reminderSentAt || subscription.reminderSentAt < new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000))) {
      await sendSms(org.phone, `Your ${org.agencyName} subscription expires on ${periodEnd.toLocaleDateString('en-BD')}. Open Billing to request renewal and follow the manual payment instructions.`)
      subscription.reminderSentAt = now; await org.save(); reminders += 1
    }
  }
  return { transitioned, reminders, scheduledChanges }
}
