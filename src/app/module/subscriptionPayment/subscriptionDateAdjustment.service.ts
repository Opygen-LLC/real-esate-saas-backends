import httpStatus from 'http-status'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit } from '../audit/audit.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { LeadAddonSubscription } from '../leadAddonSubscription/leadAddonSubscription.model'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { SubscriptionPayment } from './subscriptionPayment.model'

export interface SubscriptionDateAdjustmentInput {
  paidAt: Date
  periodStart: Date
  periodEnd: Date
  reason: string
}

export interface SubscriptionDateAdjustmentActor {
  id: string
  requestId?: string
  ip?: string
}

const commercialTransaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => { value = await work(session) })
      if (value === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Subscription date adjustment did not complete')
      return value
    } finally {
      await session.endSession()
    }
  }
  if (config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Subscription date adjustments require a MongoDB replica set or mongos in production')
  }
  return work()
}

const sameDate = (left?: Date | null, right?: Date | null) => Boolean(left && right && new Date(left).getTime() === new Date(right).getTime())

const validateInput = (input: SubscriptionDateAdjustmentInput) => {
  const paidAt = new Date(input.paidAt)
  const periodStart = new Date(input.periodStart)
  const periodEnd = new Date(input.periodEnd)
  if (![paidAt, periodStart, periodEnd].every((value) => Number.isFinite(value.getTime()))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Paid At, Period Start and Period End must be valid dates')
  }
  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Period End / Access Until must be later than Period Start')
  }
  if (String(input.reason || '').trim().length < 10) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An audit reason of at least 10 characters is required')
  }
  return { paidAt, periodStart, periodEnd, reason: String(input.reason).trim() }
}

const editConfirmedPaymentDates = async (
  paymentNumber: string,
  rawInput: SubscriptionDateAdjustmentInput,
  actor: SubscriptionDateAdjustmentActor,
) => {
  const input = validateInput(rawInput)
  const result = await commercialTransaction(async (session) => {
    const paymentQuery = SubscriptionPayment.findOne({ paymentNumber })
    if (session) paymentQuery.session(session)
    const payment: any = await paymentQuery
    if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription payment not found')
    if (payment.status !== 'confirmed') throw new ApiError(httpStatus.CONFLICT, 'Only confirmed paid subscriptions can have billing dates adjusted')
    if (!payment.periodStart || !payment.periodEnd) throw new ApiError(httpStatus.CONFLICT, 'This confirmed payment has no canonical billing period to edit')

    const organizationQuery = Organization.findOne({ organizationId: payment.organizationId })
    if (session) organizationQuery.session(session)
    const organization: any = await organizationQuery
    if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

    const benefitQuery = SubscriptionBenefitPeriod.findOne({
      paymentNumber: payment.paymentNumber,
      organizationId: payment.organizationId,
      $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }],
    })
    if (session) benefitQuery.session(session)
    const benefit: any = await benefitQuery
    if (!benefit) throw new ApiError(httpStatus.CONFLICT, 'The linked subscription benefit period could not be found; dates were not changed')

    const overlapQuery = SubscriptionBenefitPeriod.findOne({
      _id: { $ne: benefit._id },
      organizationId: payment.organizationId,
      periodStart: { $lt: input.periodEnd },
      periodEnd: { $gt: input.periodStart },
      $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }],
    }).select('_id paymentNumber periodStart periodEnd')
    if (session) overlapQuery.session(session)
    const overlap: any = await overlapQuery.lean()
    if (overlap) {
      throw new ApiError(httpStatus.CONFLICT, `The requested period overlaps ${overlap.paymentNumber || 'another paid benefit period'}. Adjust or resolve that period first.`)
    }

    const oldPaidAt = payment.paidAt ? new Date(payment.paidAt) : null
    const oldPeriodStart = new Date(payment.periodStart)
    const oldPeriodEnd = new Date(payment.periodEnd)
    const organizationPeriodEnd = organization.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
    const organizationPeriodStart = organization.subscription?.currentPeriodStart ? new Date(organization.subscription.currentPeriodStart) : null
    const isCurrentSubscriptionPayment = String(organization.subscription?.plan || '') === String(payment.planId)
      && Number(organization.subscription?.planVersion || 0) === Number(payment.planVersion || 0)
      && sameDate(organizationPeriodEnd, oldPeriodEnd)
      && ['active', 'grace', 'cancel_at_period_end', 'past_due'].includes(String(organization.subscription?.status || ''))

    payment.paidAt = input.paidAt
    payment.periodStart = input.periodStart
    payment.periodEnd = input.periodEnd
    await payment.save(session ? { session } : undefined)

    benefit.periodStart = input.periodStart
    benefit.periodEnd = input.periodEnd
    await benefit.save(session ? { session } : undefined)

    let addonUpdateCount = 0
    if (isCurrentSubscriptionPayment) {
      const orgSet: Record<string, unknown> = {
        'subscription.currentPeriodStart': input.periodStart,
        'subscription.currentPeriodEnd': input.periodEnd,
        'subscription.lastPaymentDate': input.paidAt,
      }
      const orgUpdate = Organization.updateOne(
        { _id: organization._id, 'subscription.currentPeriodEnd': oldPeriodEnd },
        { $set: orgSet, $inc: { 'subscription.revision': 1, subscriptionBenefitRevision: 1 } },
      )
      if (session) orgUpdate.session(session)
      const orgResult = await orgUpdate
      if (orgResult.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Subscription changed concurrently. Reload and try again.')

      const addonFilter = {
        organizationId: payment.organizationId,
        status: { $in: ['active', 'cancel_at_period_end'] },
        currentPeriodEnd: oldPeriodEnd,
      }
      const addonsQuery = LeadAddonSubscription.find(addonFilter)
      if (session) addonsQuery.session(session)
      const addons: any[] = await addonsQuery
      for (const addon of addons) {
        if (addon.currentPeriodStart && sameDate(addon.currentPeriodStart, oldPeriodStart)) addon.currentPeriodStart = input.periodStart
        addon.currentPeriodEnd = input.periodEnd
        await addon.save(session ? { session } : undefined)
        addonUpdateCount += 1
      }
    }

    await writeAudit({
      organizationId: payment.organizationId,
      actorId: actor.id,
      actorRole: 'super-admin',
      action: 'subscription_date_changed',
      entityType: 'subscriptionPayment',
      entityId: String(payment._id),
      reason: input.reason,
      requestId: actor.requestId,
      ip: actor.ip,
      metadata: {
        customerId: payment.organizationId,
        subscriptionId: String(organization._id),
        paymentId: String(payment._id),
        paymentNumber: payment.paymentNumber,
        oldPaidAt,
        newPaidAt: input.paidAt,
        oldPeriodStart,
        newPeriodStart: input.periodStart,
        oldPeriodEnd,
        newPeriodEnd: input.periodEnd,
        changedBy: actor.id,
        changedAt: new Date(),
        reason: input.reason,
        currentSubscriptionUpdated: isCurrentSubscriptionPayment,
        previousOrganizationPeriodStart: organizationPeriodStart,
        recurringAddonPeriodsUpdated: addonUpdateCount,
      },
    }, session)

    return {
      organizationId: payment.organizationId,
      paymentNumber: payment.paymentNumber,
      planId: payment.planId,
      planVersion: payment.planVersion,
      paidAt: payment.paidAt,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      currentSubscriptionUpdated: isCurrentSubscriptionPayment,
      recurringAddonPeriodsUpdated: addonUpdateCount,
    }
  })

  await CacheInvalidationService.invalidateTenant(result.organizationId)
  RealtimeService.emitOrganization(result.organizationId, {
    type: 'subscription.changed',
    action: 'subscription_dates_adjusted',
    entityId: result.paymentNumber,
    payload: {
      paymentNumber: result.paymentNumber,
      paidAt: result.paidAt,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      currentSubscriptionUpdated: result.currentSubscriptionUpdated,
    },
  })
  RealtimeService.emitRole('super-admin', {
    type: 'platform.notification.changed',
    action: 'updated',
    entityId: result.paymentNumber,
    eventType: 'subscription_date_changed',
  })
  return result
}

export const SubscriptionDateAdjustmentService = { editConfirmedPaymentDates }
