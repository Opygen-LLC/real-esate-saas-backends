import { sendSms } from '../../helpers/sendOtp'
import { writeAudit } from '../audit/audit.service'
import { Organization } from '../organization/organization.model'
import type { SubscriptionStatus } from '../organization/organization.interface'
import { getTrialPolicy, type TrialPolicy } from '../platformSettings/trialPolicy.service'
import { SubscriptionScheduleService } from './subscriptionSchedule.service'

const DAY_MS = 24 * 60 * 60 * 1000

export type SubscriptionBoundarySnapshot = {
  organizationId: string
  plan: string
  planVersion: number
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  gracePeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

type BoundaryTransition = {
  nextStatus: SubscriptionStatus
  gracePeriodEnd: Date | null
}

const snapshot = (organization: any): SubscriptionBoundarySnapshot => ({
  organizationId: String(organization.organizationId),
  plan: String(organization.subscription?.plan || 'trial'),
  planVersion: Math.max(1, Number(organization.subscription?.planVersion || 1)),
  status: String(organization.subscription?.status || 'expired') as SubscriptionStatus,
  currentPeriodEnd: organization.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null,
  gracePeriodEnd: organization.subscription?.gracePeriodEnd ? new Date(organization.subscription.gracePeriodEnd) : null,
  cancelAtPeriodEnd: Boolean(organization.subscription?.cancelAtPeriodEnd),
})

const graceDaysFor = (organization: any, policy: TrialPolicy): number =>
  String(organization.subscription?.plan || 'trial') === 'trial'
    ? Math.max(0, Number(policy.trialGraceDays ?? policy.gracePeriodDays ?? 0))
    : Math.max(0, Number(policy.paidRenewalGraceDays ?? 0))

const boundaryTransition = (organization: any, now: Date, policy: TrialPolicy): BoundaryTransition | null => {
  const subscription: any = organization.subscription || {}
  const status = String(subscription.status || '') as SubscriptionStatus
  const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null
  const gracePeriodEnd = subscription.gracePeriodEnd ? new Date(subscription.gracePeriodEnd) : null

  if (status === 'grace') {
    if (!gracePeriodEnd || gracePeriodEnd.getTime() <= now.getTime()) {
      return { nextStatus: 'expired', gracePeriodEnd: null }
    }
    return null
  }

  if (status === 'cancel_at_period_end') {
    if (periodEnd && periodEnd.getTime() <= now.getTime()) return { nextStatus: 'expired', gracePeriodEnd: null }
    return null
  }

  if (!['trialing', 'active', 'past_due'].includes(status) || !periodEnd || periodEnd.getTime() > now.getTime()) return null

  const graceDays = graceDaysFor(organization, policy)
  if (graceDays <= 0) return { nextStatus: 'expired', gracePeriodEnd: null }

  // Grace always begins at the contractual billing boundary, not at the time a
  // delayed worker happens to notice it. This prevents late cron runs from
  // accidentally extending paid/trial access.
  const graceEnd = new Date(periodEnd.getTime() + graceDays * DAY_MS)
  if (graceEnd.getTime() <= now.getTime()) return { nextStatus: 'expired', gracePeriodEnd: null }
  return { nextStatus: 'grace', gracePeriodEnd: graceEnd }
}

const applyBoundaryTransition = async (organization: any, now: Date, policy: TrialPolicy, actorId: string) => {
  const transition = boundaryTransition(organization, now, policy)
  if (!transition) return { changed: false as const, organization }

  const previousStatus = String(organization.subscription?.status || '') as SubscriptionStatus
  const expectedRevision = Math.max(0, Number(organization.subscription?.revision || 0))
  const updated: any = await Organization.findOneAndUpdate(
    {
      _id: organization._id,
      'subscription.status': previousStatus,
      'subscription.revision': expectedRevision,
    },
    {
      $set: {
        'subscription.status': transition.nextStatus,
        'subscription.gracePeriodEnd': transition.gracePeriodEnd,
      },
      $inc: { 'subscription.revision': 1 },
    },
    { new: true },
  )

  if (!updated) {
    // Another worker/request won the boundary race. Return the authoritative row.
    const concurrent = await Organization.findOne({ organizationId: organization.organizationId })
    return { changed: false as const, organization: concurrent || organization }
  }

  await writeAudit({
    organizationId: updated.organizationId,
    actorId,
    actorRole: 'system',
    action: 'subscription.status_changed',
    entityType: 'organization',
    entityId: String(updated._id),
    metadata: {
      previous: previousStatus,
      next: transition.nextStatus,
      currentPeriodEnd: updated.subscription?.currentPeriodEnd || null,
      gracePeriodEnd: transition.gracePeriodEnd,
      plan: updated.subscription?.plan || 'trial',
    },
  })

  return { changed: true as const, organization: updated }
}

/**
 * Request-time lifecycle reconciliation. The cron worker remains the normal
 * batch path, but this method makes the billing boundary authoritative even if
 * the worker is late or an API request arrives exactly at period end.
 */
export const reconcileOrganizationSubscriptionBoundary = async (
  organizationId: string,
  now = new Date(),
  actorId = 'system:subscription-access',
): Promise<SubscriptionBoundarySnapshot> => {
  let organization: any = await Organization.findOne({ organizationId })
  if (!organization) throw new Error(`Organization ${organizationId} not found`)

  if (organization.subscription?.scheduledPlan
    && organization.subscription?.scheduledEffectiveAt
    && new Date(organization.subscription.scheduledEffectiveAt).getTime() <= now.getTime()) {
    await SubscriptionScheduleService.applyDueChange(organizationId, { actorId })
    organization = await Organization.findOne({ organizationId })
    if (!organization) throw new Error(`Organization ${organizationId} not found after scheduled subscription change`)
  }

  const policy = await getTrialPolicy()
  const result = await applyBoundaryTransition(organization, now, policy, actorId)
  return snapshot(result.organization)
}

export const reconcileSubscriptions = async (): Promise<{ transitioned: number; reminders: number; scheduledChanges: Awaited<ReturnType<typeof SubscriptionScheduleService.processDueChanges>> }> => {
  const now = new Date()
  // Apply paid deferred downgrades before expiry/grace logic sees the old period boundary.
  const scheduledChanges = await SubscriptionScheduleService.processDueChanges(100, now)
  const policy = await getTrialPolicy()
  const reminderMs = Math.max(0, Number(policy.reminderDaysBeforeExpiry || 0)) * DAY_MS
  const organizations = await Organization.find({ 'subscription.status': { $in: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end'] } })
  let transitioned = 0
  let reminders = 0

  for (const org of organizations) {
    const transition = await applyBoundaryTransition(org, now, policy, 'system:subscription-lifecycle')
    if (transition.changed) {
      transitioned += 1
      continue
    }

    const current: any = transition.organization || org
    const periodEnd = current.subscription?.currentPeriodEnd ? new Date(current.subscription.currentPeriodEnd) : null
    const reminderSentAt = current.subscription?.reminderSentAt ? new Date(current.subscription.reminderSentAt) : null
    if (periodEnd
      && periodEnd.getTime() - now.getTime() > 0
      && periodEnd.getTime() - now.getTime() <= reminderMs
      && (!reminderSentAt || reminderSentAt < new Date(periodEnd.getTime() - 30 * DAY_MS))) {
      await sendSms(current.phone, `Your ${current.agencyName} subscription expires on ${periodEnd.toLocaleDateString('en-BD')}. Open Billing to request renewal and follow the manual payment instructions.`)
      current.subscription.reminderSentAt = now
      await current.save()
      reminders += 1
    }
  }

  return { transitioned, reminders, scheduledChanges }
}
