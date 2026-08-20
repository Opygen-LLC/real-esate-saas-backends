import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import type { SubscriptionPlanId } from '../subscriptionPlan/subscriptionPlan.interface'
import { SubscriptionBenefitPeriod } from './subscriptionBenefitPeriod.model'
import { SubscriptionBenefitStreakAdjustment } from './subscriptionBenefitAdjustment.model'
import { writeAudit } from '../audit/audit.service'
import type { BenefitBillingCycle, BenefitPaymentSource } from './subscriptionBenefitPeriod.interface'

const DAY_MS = 24 * 60 * 60 * 1000

export interface BenefitPlanSnapshot {
  planId: SubscriptionPlanId
  version: number
  baseMonthlyLeadAllowance: number
  renewalLeadBonus: number
  renewalBonusEnabled: boolean
  maxRenewalLeadBonus: number
  continuityGraceDays: number
}

export interface BenefitPeriodInput {
  organizationId: string
  paymentSource: BenefitPaymentSource
  paymentNumber: string
  billingCycle: BenefitBillingCycle
  periodStart: Date
  periodEnd: Date
  plan: BenefitPlanSnapshot
}

export interface PreviousBenefitPeriodSnapshot {
  _id?: unknown
  planId: SubscriptionPlanId
  billingCycle: BenefitBillingCycle
  periodEnd: Date
  renewalStreak: number
  renewalBonusEnabled?: boolean
}

export interface BenefitAllowanceCalculation {
  renewalStreak: number
  baseLeadAllowance: number
  bonusLeadAllowance: number
  totalLeadAllowance: number
  renewalBonusEnabled: boolean
  renewalLeadBonus: number
  maxRenewalLeadBonus: number
  continuityGraceDays: number
}

const integer = (value: unknown): number => Math.max(0, Math.trunc(Number(value || 0)))

const isConsecutiveStarterMonthlyPeriod = (
  plan: BenefitPlanSnapshot,
  billingCycle: BenefitBillingCycle,
  previous: PreviousBenefitPeriodSnapshot | null,
  currentStart: Date,
  graceDays: number,
): boolean => {
  if (plan.planId !== 'starter' || billingCycle !== 'monthly') return false
  if (!previous || previous.planId !== plan.planId || previous.billingCycle !== 'monthly') return false
  if (previous.renewalBonusEnabled !== true) return false

  const previousEnd = new Date(previous.periodEnd).getTime()
  const current = currentStart.getTime()
  if (!Number.isFinite(previousEnd) || !Number.isFinite(current)) return false

  // A renewal can only extend a streak after the prior paid period has completed.
  // On-time prepayments are scheduled to begin exactly at previousEnd by the payment services.
  if (current < previousEnd) return false

  // Late renewals may keep continuity only inside the plan version's configured grace window.
  return current <= previousEnd + graceDays * DAY_MS
}

export const calculateBenefitPeriodAllowance = (
  plan: BenefitPlanSnapshot,
  billingCycle: BenefitBillingCycle,
  periodStart: Date,
  previous: PreviousBenefitPeriodSnapshot | null,
): BenefitAllowanceCalculation => {
  const baseMonthly = integer(plan.baseMonthlyLeadAllowance)
  const renewalLeadBonus = integer(plan.renewalLeadBonus)
  const maxRenewalLeadBonus = integer(plan.maxRenewalLeadBonus)
  const continuityGraceDays = Math.min(31, integer(plan.continuityGraceDays))

  // Phase 11 intentionally limits the loyalty program to paid monthly Starter renewals.
  // Other plans can still snapshot a base paid-period allowance, but they cannot earn this streak bonus.
  const starterMonthlyBonusConfigured = plan.planId === 'starter'
    && billingCycle === 'monthly'
    && Boolean(plan.renewalBonusEnabled)
    && renewalLeadBonus > 0

  // The commercial field is explicitly monthly. A yearly paid period receives twelve
  // monthly base allocations as one immutable period snapshot; loyalty streaks remain monthly-only.
  const baseLeadAllowance = billingCycle === 'yearly' ? baseMonthly * 12 : baseMonthly
  const consecutive = starterMonthlyBonusConfigured
    && isConsecutiveStarterMonthlyPeriod(plan, billingCycle, previous, periodStart, continuityGraceDays)
  const renewalStreak = consecutive ? Math.max(1, integer(previous?.renewalStreak)) + 1 : 1
  const uncappedBonus = starterMonthlyBonusConfigured ? Math.max(0, renewalStreak - 1) * renewalLeadBonus : 0
  const bonusLeadAllowance = starterMonthlyBonusConfigured ? Math.min(uncappedBonus, maxRenewalLeadBonus) : 0

  return {
    renewalStreak,
    baseLeadAllowance,
    bonusLeadAllowance,
    totalLeadAllowance: baseLeadAllowance + bonusLeadAllowance,
    renewalBonusEnabled: starterMonthlyBonusConfigured,
    renewalLeadBonus,
    maxRenewalLeadBonus,
    continuityGraceDays,
  }
}

const validateInput = (input: BenefitPeriodInput) => {
  if (!input.organizationId.trim()) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization is required for the benefit period')
  if (!input.paymentNumber.trim()) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment number is required for the benefit period')
  if (!(input.periodStart instanceof Date) || Number.isNaN(input.periodStart.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Benefit period start is invalid')
  if (!(input.periodEnd instanceof Date) || Number.isNaN(input.periodEnd.getTime()) || input.periodEnd <= input.periodStart) throw new ApiError(httpStatus.BAD_REQUEST, 'Benefit period end must be after its start')
}

const findExisting = async (paymentSource: BenefitPaymentSource, paymentNumber: string, session?: ClientSession) => {
  const query = SubscriptionBenefitPeriod.findOne({ paymentSource, paymentNumber })
  if (session) query.session(session)
  return query
}

const findPreviousConfirmedBenefitPeriod = async (
  organizationId: string,
  session?: ClientSession,
): Promise<PreviousBenefitPeriodSnapshot | null> => {
  // Continuity follows the actual sequence of confirmed paid subscription periods.
  // Searching across every plan family is deliberate: Starter -> Professional -> Starter must reset.
  const query = SubscriptionBenefitPeriod.findOne({ organizationId })
    .sort({ createdAt: -1, _id: -1 })
    .select('planId billingCycle periodEnd renewalStreak renewalBonusEnabled')
    .lean()
  if (session) query.session(session)
  return query as unknown as PreviousBenefitPeriodSnapshot | null
}

const applyLatestSupportStreakAdjustment = async (
  organizationId: string,
  previous: PreviousBenefitPeriodSnapshot | null,
  session?: ClientSession,
): Promise<PreviousBenefitPeriodSnapshot | null> => {
  if (!previous?._id || previous.planId !== 'starter' || previous.billingCycle !== 'monthly') return previous
  const query = SubscriptionBenefitStreakAdjustment.findOne({
    organizationId,
    benefitPeriodId: String(previous._id),
  }).sort({ createdAt: -1, _id: -1 }).select('adjustedRenewalStreak').lean()
  if (session) query.session(session)
  const adjustment: any = await query
  if (!adjustment) return previous
  return { ...previous, renewalStreak: Math.max(1, integer(adjustment.adjustedRenewalStreak)) }
}

const createForPaidSubscription = async (input: BenefitPeriodInput, session?: ClientSession) => {
  validateInput(input)
  const existing: any = await findExisting(input.paymentSource, input.paymentNumber, session)
  if (existing) {
    const sameIdentity = existing.organizationId === input.organizationId
      && existing.planId === input.plan.planId
      && Number(existing.planVersion) === Number(input.plan.version)
    if (!sameIdentity) throw new ApiError(httpStatus.CONFLICT, 'Payment is already linked to a different subscription benefit period')
    return { period: existing, created: false as const }
  }

  // This service is invoked only by confirmed paid activation paths. The previous ledger row,
  // not the current Organization.subscription object, defines continuity and plan-switch resets.
  const previous = await findPreviousConfirmedBenefitPeriod(input.organizationId, session)
  const effectivePrevious = await applyLatestSupportStreakAdjustment(input.organizationId, previous, session)
  const allowance = calculateBenefitPeriodAllowance(input.plan, input.billingCycle, input.periodStart, effectivePrevious)

  try {
    const docs = await SubscriptionBenefitPeriod.create([{
      organizationId: input.organizationId,
      paymentSource: input.paymentSource,
      paymentNumber: input.paymentNumber,
      planId: input.plan.planId,
      planVersion: input.plan.version,
      billingCycle: input.billingCycle,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ...allowance,
      usedLeadAllowance: 0,
    }], session ? { session } : undefined)
    return { period: docs[0], created: true as const }
  } catch (error: any) {
    if (Number(error?.code) !== 11000) throw error
    const concurrent: any = await findExisting(input.paymentSource, input.paymentNumber, session)
    if (!concurrent) throw error
    return { period: concurrent, created: false as const }
  }
}

const getHistory = async (query: any = {}) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const filter: any = {}
  if (query.organizationId) filter.organizationId = String(query.organizationId).trim()
  if (query.planId) filter.planId = String(query.planId).trim()
  if (query.paymentSource) filter.paymentSource = String(query.paymentSource).trim()
  if (query.from || query.to) {
    filter.periodStart = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(`${String(query.to)}T23:59:59.999Z`) } : {}),
    }
  }
  if (query.search) {
    const escaped = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { paymentNumber: { $regex: escaped, $options: 'i' } },
      { organizationId: { $regex: escaped, $options: 'i' } },
    ]
  }

  const [rows, total] = await Promise.all([
    SubscriptionBenefitPeriod.find(filter).sort({ periodStart: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SubscriptionBenefitPeriod.countDocuments(filter),
  ])
  const organizationIds = [...new Set(rows.map((row: any) => row.organizationId))]
  const organizations = await Organization.find({ organizationId: { $in: organizationIds } }).select('organizationId agencyName email').lean()
  const organizationMap = new Map(organizations.map((organization: any) => [organization.organizationId, organization]))

  return {
    data: rows.map((row: any) => ({ ...row, organization: organizationMap.get(row.organizationId) || null })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}


const benefitPeriodStatus = (periodStart: Date, periodEnd: Date) => {
  const now = Date.now()
  const start = new Date(periodStart).getTime()
  const end = new Date(periodEnd).getTime()
  if (now < start) return 'upcoming' as const
  if (now >= end) return 'expired' as const
  return 'active' as const
}

const getLatestStreakAdjustment = async (organizationId: string, benefitPeriodId: string, session?: ClientSession) => {
  const query = SubscriptionBenefitStreakAdjustment.findOne({ organizationId, benefitPeriodId })
    .sort({ createdAt: -1, _id: -1 })
    .lean()
  if (session) query.session(session)
  return query
}

const getEffectiveRenewalStreakForPeriod = async (
  organizationId: string,
  benefitPeriodId: string | null | undefined,
  grantedRenewalStreak: number,
  session?: ClientSession,
): Promise<number> => {
  const granted = Math.max(1, integer(grantedRenewalStreak))
  if (!benefitPeriodId) return granted
  const adjustment: any = await getLatestStreakAdjustment(String(organizationId || '').trim(), String(benefitPeriodId), session)
  return adjustment ? Math.max(1, integer(adjustment.adjustedRenewalStreak)) : granted
}

const getUpcomingBenefitPeriod = async (organizationId: string, session?: ClientSession) => {
  const query = SubscriptionBenefitPeriod.findOne({
    organizationId: String(organizationId || '').trim(),
    periodStart: { $gt: new Date() },
  }).sort({ periodStart: 1, _id: 1 }).lean()
  if (session) query.session(session)
  return query
}

const getCurrentLeadEntitlement = async (organizationId: string, session?: ClientSession) => {
  const normalizedOrganizationId = String(organizationId || '').trim()
  if (!normalizedOrganizationId) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization is required')

  const organizationQuery = Organization.findOne({ organizationId: normalizedOrganizationId })
    .select('organizationId agencyName email subscription.plan subscription.planVersion subscription.status subscription.currentPeriodEnd')
    .lean()
  const periodQuery = SubscriptionBenefitPeriod.findOne({ organizationId: normalizedOrganizationId })
    .sort({ createdAt: -1, _id: -1 })
    .lean()
  if (session) {
    organizationQuery.session(session)
    periodQuery.session(session)
  }
  const [organization, period]: any[] = await Promise.all([organizationQuery, periodQuery])
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  if (!period) {
    return {
      organization: {
        organizationId: organization.organizationId,
        agencyName: organization.agencyName,
        email: organization.email,
        subscription: organization.subscription || null,
      },
      benefitPeriod: null,
      adjustment: null,
      eligibleForStreakAdjustment: false,
    }
  }

  const adjustment: any = await getLatestStreakAdjustment(normalizedOrganizationId, String(period._id), session)
  const grantedRenewalStreak = Math.max(1, integer(period.renewalStreak))
  const currentRenewalStreak = adjustment
    ? Math.max(1, integer(adjustment.adjustedRenewalStreak))
    : grantedRenewalStreak
  const remainingLeadAllowance = Math.max(0, integer(period.totalLeadAllowance) - integer(period.usedLeadAllowance))
  const eligibleForStreakAdjustment = period.planId === 'starter'
    && period.billingCycle === 'monthly'
    && period.renewalBonusEnabled === true

  return {
    organization: {
      organizationId: organization.organizationId,
      agencyName: organization.agencyName,
      email: organization.email,
      subscription: organization.subscription || null,
    },
    benefitPeriod: {
      ...period,
      status: benefitPeriodStatus(period.periodStart, period.periodEnd),
      grantedRenewalStreak,
      currentRenewalStreak,
      remainingLeadAllowance,
    },
    adjustment: adjustment || null,
    eligibleForStreakAdjustment,
  }
}

const adjustRenewalStreak = async (
  organizationId: string,
  input: { renewalStreak: number; reason: string },
  actor: { id: string; requestId?: string; ip?: string },
  session?: ClientSession,
) => {
  const normalizedOrganizationId = String(organizationId || '').trim()
  const renewalStreak = Number(input.renewalStreak)
  const reason = String(input.reason || '').trim()
  if (!normalizedOrganizationId) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization is required')
  if (!Number.isInteger(renewalStreak) || renewalStreak < 1 || renewalStreak > 10000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Renewal streak must be a whole number between 1 and 10000')
  }
  if (reason.length < 10 || reason.length > 500) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A support reason between 10 and 500 characters is required')
  }

  const organizationQuery = Organization.findOne({ organizationId: normalizedOrganizationId }).select('organizationId')
  const periodQuery = SubscriptionBenefitPeriod.findOne({ organizationId: normalizedOrganizationId })
    .sort({ createdAt: -1, _id: -1 })
  if (session) {
    organizationQuery.session(session)
    periodQuery.session(session)
  }
  const [organization, period]: any[] = await Promise.all([organizationQuery, periodQuery])
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (!period) throw new ApiError(httpStatus.CONFLICT, 'This tenant has no paid benefit period to adjust')
  if (period.planId !== 'starter' || period.billingCycle !== 'monthly' || period.renewalBonusEnabled !== true) {
    throw new ApiError(httpStatus.CONFLICT, 'Renewal streak adjustments are available only for Starter monthly loyalty periods')
  }

  const latestAdjustment: any = await getLatestStreakAdjustment(normalizedOrganizationId, String(period._id), session)
  const previousEffectiveRenewalStreak = latestAdjustment
    ? Math.max(1, integer(latestAdjustment.adjustedRenewalStreak))
    : Math.max(1, integer(period.renewalStreak))
  if (previousEffectiveRenewalStreak === renewalStreak) {
    throw new ApiError(httpStatus.CONFLICT, `Renewal streak is already ${renewalStreak}`)
  }

  const docs = await SubscriptionBenefitStreakAdjustment.create([{
    organizationId: normalizedOrganizationId,
    benefitPeriodId: String(period._id),
    paymentNumber: period.paymentNumber,
    planId: period.planId,
    planVersion: period.planVersion,
    previousEffectiveRenewalStreak,
    adjustedRenewalStreak: renewalStreak,
    reason,
    actorId: actor.id,
    requestId: actor.requestId || '',
    ip: actor.ip || '',
  }], session ? { session } : undefined)
  const adjustment: any = docs[0]

  await writeAudit({
    organizationId: normalizedOrganizationId,
    actorId: actor.id,
    actorRole: 'super-admin',
    action: 'subscription.renewal_streak_adjusted',
    entityType: 'subscriptionBenefitStreakAdjustment',
    entityId: String(adjustment._id),
    reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      benefitPeriodId: String(period._id),
      paymentNumber: period.paymentNumber,
      planId: period.planId,
      planVersion: period.planVersion,
      previousEffectiveRenewalStreak,
      adjustedRenewalStreak: renewalStreak,
      currentPeriodAllowanceUnchanged: true,
      totalLeadAllowance: period.totalLeadAllowance,
      usedLeadAllowance: period.usedLeadAllowance,
    },
  }, session)

  return adjustment
}

export const SubscriptionBenefitPeriodService = {
  createForPaidSubscription,
  getHistory,
  getCurrentLeadEntitlement,
  getEffectiveRenewalStreakForPeriod,
  getUpcomingBenefitPeriod,
  adjustRenewalStreak,
}
