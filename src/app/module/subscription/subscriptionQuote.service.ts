import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { calculateChargeFromBaseAmount } from '../billing/pricing'
import { Lead } from '../lead/lead.model'
import { LeadTopupGrantService } from '../leadTopupGrant/leadTopupGrant.service'
import { LeadAddonSubscriptionService } from '../leadAddonSubscription/leadAddonSubscription.service'
import { Organization } from '../organization/organization.model'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { calculateBenefitPeriodAllowance } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { resolvePlanLeadPolicy, toBenefitPlanSnapshot } from '../subscriptionPlan/planLeadPolicy'
import { addonCapacityWithinLimit, resolveMaxAddonLeadCapacity } from '../subscriptionPlan/planAddonCapacity'
import { classifySubscriptionChange, type SubscriptionChangeType } from './subscriptionSchedule.service'

export type SubscriptionQuoteChangeType = SubscriptionChangeType | 'renewal' | 'new_subscription'
export type QuoteBillingCycle = 'monthly' | 'yearly'

export interface SubscriptionQuoteSnapshot {
  version: 1
  calculatedAt: Date
  changeType: SubscriptionQuoteChangeType
  currency: 'BDT'
  currentPlan: {
    planId: string
    planName: string
    planVersion: number
    billingCycle: QuoteBillingCycle | null
    recurringPrice: number
  } | null
  targetPlan: {
    planId: string
    planName: string
    planVersion: number
    billingCycle: QuoteBillingCycle
    recurringPrice: number
  }
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  currentRenewalDate: Date | null
  effectiveAt: Date
  nextRenewalAt: Date | null
  remainingSeconds: number
  totalPeriodSeconds: number
  remainingFraction: number
  catalogAmountDueNow: number
  dueNow: number
  nextRenewalPrice: number
  recurringAddonCapacity: number
  recurringAddonPriceMonthly: number
  recurringAddonCyclePrice: number
  recurringAddonCount: number
  renewingRecurringAddonCapacity: number
  renewingRecurringAddonCount: number
  taxSnapshot: {
    invoiceEnabled: boolean
    registrationStatus: 'not_registered' | 'registered'
    operatorLegalName: string
    binEncrypted?: string
    vatRate: number
    pricesIncludeVat: boolean
    baseAmount: number
    vatAmount: number
  }
  nextRenewalTaxSnapshot: {
    invoiceEnabled: boolean
    registrationStatus: 'not_registered' | 'registered'
    operatorLegalName: string
    binEncrypted?: string
    vatRate: number
    pricesIncludeVat: boolean
    baseAmount: number
    vatAmount: number
  }
  leadCapacityBefore: number
  leadCapacityAfter: number
  storedLeads: number
  lockedLeadsBefore: number
  estimatedLockedLeadsAfter: number
  lockedLeadsUnlocked: number
  preserveRenewalDate: boolean
  paymentPurpose: 'current_period_upgrade' | 'next_period_downgrade' | 'renewal' | 'new_subscription' | 'version_change'
}

type QuoteInput = {
  planId: string
  planVersion?: number
  billingCycle: QuoteBillingCycle
  now?: Date
}

const paidStatuses = new Set(['active', 'grace', 'cancel_at_period_end'])
const nonVoidedFilter = () => ({ $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }] })
const money = (value: number) => Number(Math.max(0, Number(value || 0)).toFixed(2))

const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

const addBillingCycle = (start: Date, cycle: QuoteBillingCycle) => {
  const end = new Date(start)
  if (cycle === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

const recurringPrice = (plan: any, cycle: QuoteBillingCycle) => money(cycle === 'yearly' ? plan?.priceYearly : plan?.priceMonthly)

const resolvePlan = async (planId: string, planVersion?: number, session?: ClientSession) => {
  const now = new Date()
  const query = SubscriptionPlan.findOne({
    planId,
    ...(planVersion ? { version: Number(planVersion) } : {
      isCurrent: true,
      isActive: true,
      effectiveFrom: { $lte: now },
      $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }],
    }),
  })
  if (session) query.session(session)
  const plan: any = await query.lean()
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan version not found')
  return resolvePlanLeadPolicy(plan)
}

const inferCycle = (period: any, organization: any): QuoteBillingCycle | null => {
  if (period?.billingCycle === 'monthly' || period?.billingCycle === 'yearly') return period.billingCycle
  const start = organization?.subscription?.lastPaymentDate ? new Date(organization.subscription.lastPaymentDate) : null
  const end = organization?.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null
  return end.getTime() - start.getTime() > 180 * 24 * 60 * 60 * 1000 ? 'yearly' : 'monthly'
}

const periodBoundaries = (period: any, organization: any, cycle: QuoteBillingCycle | null) => {
  const end = organization?.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
  if (period?.periodStart && period?.periodEnd) {
    return { start: new Date(period.periodStart), end: new Date(period.periodEnd) }
  }
  const lastPayment = organization?.subscription?.lastPaymentDate ? new Date(organization.subscription.lastPaymentDate) : null
  if (lastPayment && end && Number.isFinite(lastPayment.getTime()) && Number.isFinite(end.getTime()) && end > lastPayment) {
    return { start: lastPayment, end }
  }
  if (end && cycle) {
    const start = new Date(end)
    if (cycle === 'yearly') start.setUTCFullYear(start.getUTCFullYear() - 1)
    else start.setUTCMonth(start.getUTCMonth() - 1)
    return { start, end }
  }
  return { start: null, end }
}

const targetLeadCapacity = (plan: any, billingCycle: QuoteBillingCycle) => {
  const activeCapacity = plan?.leadAllowanceModel === 'active_capacity'
  const baseMonthly = Math.max(0, Math.trunc(Number(plan?.baseMonthlyLeadAllowance ?? plan?.maxLeads ?? 0)))
  if (activeCapacity) return baseMonthly
  return billingCycle === 'yearly' ? baseMonthly * 12 : baseMonthly
}

const currentLeadCapacity = async (organizationId: string, organization: any, activePeriod: any, session?: ClientSession) => {
  if (organization?.subscription?.plan === 'trial') {
    const trialPolicy = await getTrialPolicy()
    return Math.max(0, Math.trunc(Number(trialPolicy.maxLeads || 0)))
  }
  if (activePeriod) {
    const [topup, recurring] = await Promise.all([
      LeadTopupGrantService.getActiveGrantSummary(organizationId, activePeriod._id, session),
      LeadAddonSubscriptionService.getActiveSummary(organizationId, session),
    ])
    return Math.max(0, Math.trunc(Number(activePeriod.totalLeadAllowance || 0))) + topup.topupLeadAllowance + recurring.recurringLeadAllowance
  }
  const currentPlan = await resolvePlan(String(organization.subscription.plan), Number(organization.subscription.planVersion || 1), session)
  return targetLeadCapacity(currentPlan, inferCycle(null, organization) || 'monthly')
}

export const calculateProratedUpgradeCatalogAmount = (input: {
  currentRecurringPrice: number
  targetRecurringPrice: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  targetBillingCycle: QuoteBillingCycle
  now: Date
}) => {
  const { currentRecurringPrice, targetRecurringPrice, currentPeriodStart, currentPeriodEnd, targetBillingCycle, now } = input
  const totalPeriodSeconds = Math.max(1, (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / 1000)
  const remainingSeconds = Math.max(0, Math.min(totalPeriodSeconds, (currentPeriodEnd.getTime() - now.getTime()) / 1000))
  const targetCycleEnd = addBillingCycle(currentPeriodStart, targetBillingCycle)
  const targetCycleSeconds = Math.max(1, (targetCycleEnd.getTime() - currentPeriodStart.getTime()) / 1000)
  const currentRate = money(currentRecurringPrice) / totalPeriodSeconds
  const targetRate = money(targetRecurringPrice) / targetCycleSeconds
  return {
    amount: money(Math.max(0, targetRate - currentRate) * remainingSeconds),
    remainingSeconds: Math.round(remainingSeconds),
    totalPeriodSeconds: Math.round(totalPeriodSeconds),
    remainingFraction: Number((remainingSeconds / totalPeriodSeconds).toFixed(6)),
  }
}

const loadTax = async (session?: ClientSession) => {
  const query = PlatformSettings.findOne({ key: 'platform' }).select('+tax.binEncrypted').lean()
  if (session) query.session(session)
  const settings: any = await query
  return settings?.tax ? { ...(settings.tax as any), binEncrypted: settings.tax?.binEncrypted || '' } : null
}

const quote = async (organizationId: string, input: QuoteInput, session?: ClientSession): Promise<SubscriptionQuoteSnapshot> => {
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Quote timestamp is invalid')

  const organizationQuery = Organization.findOne({ organizationId })
  if (session) organizationQuery.session(session)
  const organization: any = await organizationQuery.lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (organization.subscription?.scheduledPlan) {
    throw new ApiError(httpStatus.CONFLICT, 'A subscription downgrade is already scheduled. Cancel it before requesting another quote.')
  }

  const targetPlan = await resolvePlan(String(input.planId), input.planVersion, session)
  if (targetPlan.currency !== 'BDT') throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is not configured for BDT billing')

  const currentPlanId = String(organization.subscription?.plan || 'trial')
  const currentPlanVersion = Number(organization.subscription?.planVersion || 1)
  const currentStatus = String(organization.subscription?.status || 'trialing')
  const currentIsPaid = currentPlanId !== 'trial' && paidStatuses.has(currentStatus)

  let activePeriod: any = null
  if (currentIsPaid) {
    const activePeriodQuery = SubscriptionBenefitPeriod.findOne({
      organizationId,
      planId: currentPlanId,
      planVersion: currentPlanVersion,
      periodStart: { $lte: now },
      periodEnd: { $gt: now },
      ...nonVoidedFilter(),
    }).sort({ periodStart: -1, _id: -1 }).lean()
    activePeriod = await withSession(activePeriodQuery, session)
  }

  const currentCycle = currentIsPaid ? inferCycle(activePeriod, organization) : null
  const boundaries = periodBoundaries(activePeriod, organization, currentCycle)
  const currentEnd = boundaries.end && boundaries.end > now ? boundaries.end : null
  const currentStart = currentEnd ? boundaries.start : null
  const activePaidPeriod = Boolean(currentIsPaid && currentStart && currentEnd && currentStart <= now && currentEnd > now)

  let currentPlan: any = null
  if (currentPlanId !== 'trial') currentPlan = await resolvePlan(currentPlanId, currentPlanVersion, session)

  let changeType: SubscriptionQuoteChangeType
  if (!currentIsPaid || !activePaidPeriod) {
    changeType = 'new_subscription'
  } else if (currentPlanId === targetPlan.planId && currentPlanVersion === Number(targetPlan.version)) {
    changeType = 'renewal'
  } else {
    changeType = await classifySubscriptionChange(currentPlanId, String(targetPlan.planId), {
      currentPlanVersion,
      requestedPlanVersion: Number(targetPlan.version),
      session,
    })
  }

  const targetPrice = recurringPrice(targetPlan, input.billingCycle)
  const currentPrice = currentPlan && currentCycle ? recurringPrice(currentPlan, currentCycle) : 0
  const activeRecurringAddons = currentIsPaid
    ? await LeadAddonSubscriptionService.getActiveSummary(organizationId, session)
    : { recurringLeadAllowance: 0, recurringAddonPriceMonthly: 0, recurringAddonCyclePrice: 0, count: 0 }
  const renewingRecurringAddons = currentIsPaid
    ? await LeadAddonSubscriptionService.getRenewingSummary(organizationId, input.billingCycle, session)
    : { recurringLeadAllowance: 0, recurringAddonPriceMonthly: 0, recurringAddonCyclePrice: 0, count: 0 }
  if (currentIsPaid && currentPlanId !== targetPlan.planId) {
    const maxAddonLeadCapacity = resolveMaxAddonLeadCapacity(targetPlan)
    const relevantAddonCapacity = changeType === 'downgrade'
      ? renewingRecurringAddons.recurringLeadAllowance
      : activeRecurringAddons.recurringLeadAllowance
    if (!addonCapacityWithinLimit(Number(relevantAddonCapacity), 0, maxAddonLeadCapacity)) {
      const limitLabel = maxAddonLeadCapacity === null ? 'unlimited' : maxAddonLeadCapacity.toLocaleString()
      throw new ApiError(
        httpStatus.CONFLICT,
        `Your recurring lead add-ons total ${Number(relevantAddonCapacity).toLocaleString()} leads, but the target plan supports only ${limitLabel}. Cancel or reduce add-ons before changing to that plan.`,
      )
    }
  }
  const periodTotalSeconds = activePaidPeriod && currentStart && currentEnd
    ? Math.max(1, (currentEnd.getTime() - currentStart.getTime()) / 1000)
    : 0
  const remainingSeconds = activePaidPeriod && currentEnd
    ? Math.max(0, (currentEnd.getTime() - now.getTime()) / 1000)
    : 0
  const remainingFraction = periodTotalSeconds > 0 ? Math.min(1, Math.max(0, remainingSeconds / periodTotalSeconds)) : 0

  let catalogAmountDueNow = targetPrice
  let effectiveAt = now
  let nextRenewalAt: Date | null = addBillingCycle(now, input.billingCycle)
  let preserveRenewalDate = false
  let paymentPurpose: SubscriptionQuoteSnapshot['paymentPurpose'] = 'new_subscription'

  if (changeType === 'upgrade' || changeType === 'version_change') {
    paymentPurpose = changeType === 'upgrade' ? 'current_period_upgrade' : 'version_change'
    if (activePaidPeriod && currentStart && currentEnd && currentCycle) {
      catalogAmountDueNow = calculateProratedUpgradeCatalogAmount({
        currentRecurringPrice: currentPrice,
        targetRecurringPrice: targetPrice,
        currentPeriodStart: currentStart,
        currentPeriodEnd: currentEnd,
        targetBillingCycle: input.billingCycle,
        now,
      }).amount
      effectiveAt = now
      nextRenewalAt = currentEnd
      preserveRenewalDate = true
    }
  } else if (changeType === 'downgrade') {
    paymentPurpose = 'next_period_downgrade'
    effectiveAt = currentEnd || now
    // The existing product uses paid/scheduled downgrades: the target period is prepaid
    // now and becomes active at the current billing boundary. No credit/refund is created.
    catalogAmountDueNow = targetPrice + renewingRecurringAddons.recurringAddonCyclePrice
    nextRenewalAt = addBillingCycle(effectiveAt, input.billingCycle)
    preserveRenewalDate = true
  } else if (changeType === 'renewal') {
    paymentPurpose = 'renewal'
    effectiveAt = currentEnd || now
    catalogAmountDueNow = targetPrice + renewingRecurringAddons.recurringAddonCyclePrice
    nextRenewalAt = addBillingCycle(effectiveAt, input.billingCycle)
    preserveRenewalDate = Boolean(currentEnd)
  }

  const tax = await loadTax(session)
  const dueCharge = calculateChargeFromBaseAmount(catalogAmountDueNow, tax)
  const nextCharge = calculateChargeFromBaseAmount(targetPrice + renewingRecurringAddons.recurringAddonCyclePrice, tax)

  const [leadCapacityBefore, storedLeads, lockedLeadsBefore] = await Promise.all([
    currentLeadCapacity(organizationId, organization, activePeriod, session),
    withSession(Lead.countDocuments({ organizationId }), session),
    withSession(Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' }), session),
  ])
  const topupAllowance = activePeriod
    ? (await LeadTopupGrantService.getActiveGrantSummary(organizationId, activePeriod._id, session)).topupLeadAllowance
    : 0
  let targetPlanCapacity = targetLeadCapacity(targetPlan, input.billingCycle)
  if (changeType === 'renewal' && activePeriod) {
    targetPlanCapacity = calculateBenefitPeriodAllowance(
      toBenefitPlanSnapshot(targetPlan),
      input.billingCycle,
      currentEnd || now,
      activePeriod,
    ).totalLeadAllowance
  }
  // A plan change grants the target plan's full capacity immediately; it is never
  // prorated with money. Active, already-paid top-up grants are preserved through a
  // mid-cycle upgrade and therefore remain additive until their original expiry.
  const recurringCapacityAfter = changeType === 'renewal' || changeType === 'downgrade'
    ? renewingRecurringAddons.recurringLeadAllowance
    : activeRecurringAddons.recurringLeadAllowance
  const leadCapacityAfter = (changeType === 'upgrade' || changeType === 'version_change')
    ? targetPlanCapacity + topupAllowance + recurringCapacityAfter
    : targetPlanCapacity + recurringCapacityAfter
  const estimatedLockedLeadsAfter = Math.max(0, Number(storedLeads || 0) - leadCapacityAfter)
  const lockedLeadsUnlocked = Math.max(0, Number(lockedLeadsBefore || 0) - estimatedLockedLeadsAfter)

  return {
    version: 1,
    calculatedAt: now,
    changeType,
    currency: 'BDT',
    currentPlan: currentPlan ? {
      planId: String(currentPlan.planId),
      planName: String(currentPlan.name || currentPlan.planId),
      planVersion: Number(currentPlan.version || currentPlanVersion),
      billingCycle: currentCycle,
      recurringPrice: currentPrice,
    } : currentPlanId === 'trial' ? {
      planId: 'trial',
      planName: 'Trial',
      planVersion: currentPlanVersion,
      billingCycle: null,
      recurringPrice: 0,
    } : null,
    targetPlan: {
      planId: String(targetPlan.planId),
      planName: String(targetPlan.name || targetPlan.planId),
      planVersion: Number(targetPlan.version || 1),
      billingCycle: input.billingCycle,
      recurringPrice: targetPrice,
    },
    currentPeriodStart: currentStart,
    currentPeriodEnd: currentEnd,
    currentRenewalDate: currentEnd,
    effectiveAt,
    nextRenewalAt,
    remainingSeconds: Math.round(remainingSeconds),
    totalPeriodSeconds: Math.round(periodTotalSeconds),
    remainingFraction: Number(remainingFraction.toFixed(6)),
    catalogAmountDueNow: money(catalogAmountDueNow),
    dueNow: dueCharge.amount,
    nextRenewalPrice: nextCharge.amount,
    recurringAddonCapacity: activeRecurringAddons.recurringLeadAllowance,
    recurringAddonPriceMonthly: activeRecurringAddons.recurringAddonPriceMonthly,
    recurringAddonCyclePrice: renewingRecurringAddons.recurringAddonCyclePrice,
    recurringAddonCount: activeRecurringAddons.count,
    renewingRecurringAddonCapacity: renewingRecurringAddons.recurringLeadAllowance,
    renewingRecurringAddonCount: renewingRecurringAddons.count,
    taxSnapshot: dueCharge.taxSnapshot,
    nextRenewalTaxSnapshot: nextCharge.taxSnapshot,
    leadCapacityBefore,
    leadCapacityAfter,
    storedLeads: Math.max(0, Number(storedLeads || 0)),
    lockedLeadsBefore: Math.max(0, Number(lockedLeadsBefore || 0)),
    estimatedLockedLeadsAfter,
    lockedLeadsUnlocked,
    preserveRenewalDate,
    paymentPurpose,
  }
}

const assertSnapshotApplicable = (organization: any, snapshot: SubscriptionQuoteSnapshot, now = new Date()) => {
  const expected = snapshot.currentPlan
  if (expected) {
    if (String(organization?.subscription?.plan || '') !== expected.planId
      || Number(organization?.subscription?.planVersion || 0) !== Number(expected.planVersion)) {
      throw new ApiError(httpStatus.CONFLICT, 'Subscription changed after this quote was created. Create a fresh quote before confirming payment.')
    }
  }
  if (snapshot.preserveRenewalDate && snapshot.currentPeriodEnd) {
    const actualEnd = organization?.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
    const expectedEnd = new Date(snapshot.currentPeriodEnd)
    if (!actualEnd || actualEnd.getTime() !== expectedEnd.getTime() || actualEnd <= now) {
      throw new ApiError(httpStatus.CONFLICT, 'The quoted billing period has ended or changed. Create a fresh quote before confirming payment.')
    }
  }
}


const assertRecurringAddonSnapshotApplicable = async (
  organizationId: string,
  snapshot: SubscriptionQuoteSnapshot,
  session?: ClientSession,
) => {
  if (!snapshot.currentPlan || snapshot.currentPlan.planId === 'trial') return
  const renewing = await LeadAddonSubscriptionService.getRenewingSummary(
    organizationId,
    snapshot.targetPlan.billingCycle,
    session,
  )
  if (Number(renewing.recurringLeadAllowance || 0) !== Number(snapshot.renewingRecurringAddonCapacity || 0)
    || Math.abs(Number(renewing.recurringAddonCyclePrice || 0) - Number(snapshot.recurringAddonCyclePrice || 0)) > 0.01) {
    throw new ApiError(httpStatus.CONFLICT, 'Recurring lead add-ons changed after this subscription quote was created. Create a fresh quote before confirming payment.')
  }
}

const toPublicQuote = (snapshot: SubscriptionQuoteSnapshot) => {
  const dueTax = { ...snapshot.taxSnapshot } as Record<string, unknown>
  const nextTax = { ...snapshot.nextRenewalTaxSnapshot } as Record<string, unknown>
  delete dueTax.binEncrypted
  delete nextTax.binEncrypted
  return { ...snapshot, taxSnapshot: dueTax, nextRenewalTaxSnapshot: nextTax }
}

export const SubscriptionQuoteService = { quote, assertSnapshotApplicable, assertRecurringAddonSnapshotApplicable, addBillingCycle, toPublicQuote }
