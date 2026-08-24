import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { IBilling } from './billing.interface'
import { Billing } from './billing.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { decryptField } from '../../helpers/fieldEncryption'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'
import { SubscriptionReceiptPdfService, type GeneratedReceiptPdf } from './subscriptionReceiptPdf.service'
import { SubscriptionBenefitPeriodService, calculateBenefitPeriodAllowance } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { SubscriptionPlanService } from '../subscriptionPlan/subscriptionPlan.service'
import { Lead } from '../lead/lead.model'
import { SubscriptionScheduleService } from '../subscription/subscriptionSchedule.service'

const createBillingRecord = async (payload: Partial<IBilling>): Promise<IBilling> => {
  if (!payload.invoiceId) {
    payload.invoiceId = 'INV-' + Date.now().toString(36).toUpperCase()
  }
  const result = await Billing.create(payload)
  return result
}

const getBillingHistory = async (organizationId: string, query: any = {}) => SubscriptionPaymentService.getTenantPaymentHistory(organizationId, query)

const usagePercentage = (used: number, limit: number): number => {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(Math.round((used / limit) * 100), 100)
}

const getSubscriptionUsage = async (organizationId: string) => {
  const [resolved, pendingChangeRequest, monthlyLeadAllowance, upcomingBenefitPeriod] = await Promise.all([
    EntitlementService.getUsageSnapshot(organizationId, { allowInactive: true }),
    SubscriptionPaymentService.getTenantPendingState(organizationId),
    EntitlementService.getMonthlyLeadAllowanceSnapshot(organizationId, { allowInactive: true }),
    SubscriptionBenefitPeriodService.getUpcomingBenefitPeriod(organizationId),
  ])

  const { organization: org, limits, usage, teamMemberQuota } = resolved
  const assignedPlanForUsage: any = org.subscription?.plan && org.subscription.plan !== 'trial'
    ? await SubscriptionPlanService.getPlanById(org.subscription.plan, Number(org.subscription.planVersion || 1))
    : null
  const currentProperties = usage.properties
  const currentLeads = usage.leads
  const lockedLeads = limits.leadAllowanceModel === 'active_capacity'
    ? await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })
    : 0
  const totalLeadRecords = currentLeads + lockedLeads
  const maxProperties = Number(limits.maxProperties || 0)
  const maxTeamMembers = Number(teamMemberQuota.maxTeamMembers || 0)
  const maxLeads = Number(limits.maxLeads || 0)
  const propertiesPercent = usagePercentage(currentProperties, maxProperties)
  const teamMembersPercent = usagePercentage(teamMemberQuota.teamMembersCommitted, maxTeamMembers)
  const leadsPercent = usagePercentage(currentLeads, maxLeads)
  const allowanceUsed = Math.max(0, Number(monthlyLeadAllowance.used || 0))
  const allowanceLimit = Math.max(0, Number(monthlyLeadAllowance.limit || 0))
  const allowancePercent = usagePercentage(allowanceUsed, allowanceLimit)
  const sourceBenefitPeriodId = monthlyLeadAllowance.benefitPeriodId || monthlyLeadAllowance.previousBenefitPeriodId || null
  const effectiveRenewalStreak = await SubscriptionBenefitPeriodService.getEffectiveRenewalStreakForPeriod(
    organizationId,
    sourceBenefitPeriodId,
    Number(monthlyLeadAllowance.renewalStreak || 1),
  )

  let nextRenewal: any = null
  if (upcomingBenefitPeriod) {
    const upcoming: any = upcomingBenefitPeriod
    const currentTotal = Math.max(0, Number(monthlyLeadAllowance.planLeadAllowance ?? monthlyLeadAllowance.limit ?? 0))
    nextRenewal = {
      alreadyConfirmed: true,
      paymentNumber: upcoming.paymentNumber || null,
      planId: upcoming.planId,
      planVersion: Number(upcoming.planVersion || 1),
      projectedRenewalStreak: Math.max(1, Number(upcoming.renewalStreak || 1)),
      baseLeadAllowance: Math.max(0, Number(upcoming.baseLeadAllowance || 0)),
      bonusLeadAllowance: Math.max(0, Number(upcoming.bonusLeadAllowance || 0)),
      totalLeadAllowance: Math.max(0, Number(upcoming.totalLeadAllowance || 0)),
      loyaltyStep: Math.max(0, Number(upcoming.renewalLeadBonus || 0)),
      allowanceChange: Math.max(0, Number(upcoming.totalLeadAllowance || 0)) - currentTotal,
      additionalLeadAllowance: Math.max(0, Math.max(0, Number(upcoming.totalLeadAllowance || 0)) - currentTotal),
      continuityPreserved: upcoming.billingCycle === 'monthly'
        && upcoming.renewalBonusEnabled === true
        && Math.max(1, Number(upcoming.renewalStreak || 1)) === effectiveRenewalStreak + 1,
      graceDays: Math.max(0, Number(upcoming.continuityGraceDays || 0)),
      renewBy: null,
      projectedPeriodStart: upcoming.periodStart,
    }
  } else if (monthlyLeadAllowance.billingCycle === 'monthly' && monthlyLeadAllowance.renewalBonusEnabled === true && sourceBenefitPeriodId) {
    // Grandfathering invariant: project renewal from the tenant's assigned immutable plan
    // version, never from the latest catalog version.
    const assignedPlan: any = assignedPlanForUsage?.planId === monthlyLeadAllowance.planId
      && Number(assignedPlanForUsage?.version || 1) === Number(monthlyLeadAllowance.planVersion || 1)
      ? assignedPlanForUsage
      : await SubscriptionPlanService.getPlanById(monthlyLeadAllowance.planId, Number(monthlyLeadAllowance.planVersion || 1))
    if (assignedPlan) {
      const now = new Date()
      const previousEnd = new Date(monthlyLeadAllowance.periodEnd || monthlyLeadAllowance.previousPeriodEnd)
      const projectedStart = previousEnd.getTime() > now.getTime() ? previousEnd : now
      const projected = calculateBenefitPeriodAllowance({
        planId: assignedPlan.planId,
        version: Number(assignedPlan.version || 1),
        leadAllowanceModel: assignedPlan.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
        baseMonthlyLeadAllowance: Number(assignedPlan.baseMonthlyLeadAllowance || 0),
        renewalLeadBonus: Number(assignedPlan.renewalLeadBonus || 0),
        renewalBonusEnabled: Boolean(assignedPlan.renewalBonusEnabled),
        maxRenewalLeadBonus: Number(assignedPlan.maxRenewalLeadBonus || 0),
        continuityGraceDays: Number(assignedPlan.continuityGraceDays || 0),
      }, 'monthly', projectedStart, {
        _id: sourceBenefitPeriodId,
        planId: assignedPlan.planId,
        billingCycle: 'monthly',
        periodEnd: previousEnd,
        renewalStreak: effectiveRenewalStreak,
        renewalBonusEnabled: monthlyLeadAllowance.renewalBonusEnabled === true,
      })
      const currentTotal = Math.max(0, Number(monthlyLeadAllowance.planLeadAllowance ?? monthlyLeadAllowance.limit ?? 0))
      const graceDays = Math.max(0, Number(assignedPlan.continuityGraceDays || 0))
      const renewBy = new Date(previousEnd.getTime() + graceDays * 24 * 60 * 60 * 1000)
      nextRenewal = {
        alreadyConfirmed: false,
        paymentNumber: null,
        planId: assignedPlan.planId,
        planVersion: Number(assignedPlan.version || 1),
        projectedRenewalStreak: projected.renewalStreak,
        baseLeadAllowance: projected.baseLeadAllowance,
        bonusLeadAllowance: projected.bonusLeadAllowance,
        totalLeadAllowance: projected.totalLeadAllowance,
        loyaltyStep: Number(assignedPlan.renewalLeadBonus || 0),
        allowanceChange: projected.totalLeadAllowance - currentTotal,
        additionalLeadAllowance: Math.max(0, projected.totalLeadAllowance - currentTotal),
        continuityPreserved: projected.renewalStreak === effectiveRenewalStreak + 1,
        graceDays,
        renewBy,
        projectedPeriodStart: projectedStart,
      }
    }
  }

  const leadAllowance = {
    mode: monthlyLeadAllowance.mode,
    status: monthlyLeadAllowance.periodInactive
      ? 'inactive'
      : (monthlyLeadAllowance.legacyFallback ? 'legacy' : 'active'),
    benefitPeriodId: monthlyLeadAllowance.benefitPeriodId,
    billingCycle: monthlyLeadAllowance.billingCycle || null,
    leadAllowanceModel: monthlyLeadAllowance.leadAllowanceModel || 'paid_period_credits',
    planId: monthlyLeadAllowance.planId,
    planVersion: monthlyLeadAllowance.planVersion,
    used: allowanceUsed,
    limit: allowanceLimit,
    percentage: allowancePercent,
    remaining: Math.max(0, allowanceLimit - allowanceUsed),
    baseAllowance: Math.max(0, Number(monthlyLeadAllowance.baseLeadAllowance || 0)),
    loyaltyBonus: Math.max(0, Number(monthlyLeadAllowance.bonusLeadAllowance || 0)),
    planAllowance: Math.max(0, Number(monthlyLeadAllowance.planLeadAllowance ?? (Number(monthlyLeadAllowance.baseLeadAllowance || 0) + Number(monthlyLeadAllowance.bonusLeadAllowance || 0)))),
    topupAllowance: Math.max(0, Number(monthlyLeadAllowance.topupLeadAllowance || 0)),
    activeTopupGrantCount: Math.max(0, Number(monthlyLeadAllowance.activeTopupGrantCount || 0)),
    recurringAddonAllowance: Math.max(0, Number(monthlyLeadAllowance.recurringLeadAllowance || 0)),
    activeRecurringAddonCount: Math.max(0, Number(monthlyLeadAllowance.activeRecurringAddonCount || 0)),
    recurringAddonPriceMonthly: Math.max(0, Number(monthlyLeadAllowance.recurringAddonPriceMonthly || 0)),
    recurringAddonCyclePrice: Math.max(0, Number(monthlyLeadAllowance.recurringAddonCyclePrice || 0)),
    baseLeadCapacity: Math.max(0, Number((limits as any).baseLeadCapacity ?? monthlyLeadAllowance.baseLeadAllowance ?? 0)),
    recurringAddonCapacity: Math.max(0, Number((limits as any).recurringAddonCapacity ?? monthlyLeadAllowance.recurringLeadAllowance ?? 0)),
    legacyTopupCapacity: Math.max(0, Number((limits as any).legacyTopupLeadAllowance ?? monthlyLeadAllowance.topupLeadAllowance ?? 0)),
    adminAdjustmentCapacity: Number((limits as any).adminAdjustmentCapacity || 0),
    effectiveLeadCapacity: Math.max(0, Number((limits as any).effectiveLeadCapacity ?? maxLeads)),
    renewalStreak: effectiveRenewalStreak,
    grantedRenewalStreak: Math.max(1, Number(monthlyLeadAllowance.renewalStreak || 1)),
    renewalBonusEnabled: monthlyLeadAllowance.renewalBonusEnabled === true,
    periodStart: monthlyLeadAllowance.periodStart || null,
    periodEnd: monthlyLeadAllowance.periodEnd || null,
    legacyFallback: Boolean(monthlyLeadAllowance.legacyFallback),
    periodInactive: Boolean(monthlyLeadAllowance.periodInactive),
    nextRenewal,
  }

  const recurringBillingCycle = monthlyLeadAllowance.billingCycle === 'yearly'
    ? 'yearly'
    : (monthlyLeadAllowance.billingCycle === 'monthly' ? 'monthly' : null)
  const basePlanRecurringPrice = assignedPlanForUsage && recurringBillingCycle
    ? Math.max(0, Number(recurringBillingCycle === 'yearly' ? assignedPlanForUsage.priceYearly : assignedPlanForUsage.priceMonthly))
    : 0
  const recurringAddonPrice = recurringBillingCycle
    ? Math.max(0, Number(monthlyLeadAllowance.recurringAddonCyclePrice || 0))
    : 0
  const billingSummary = {
    billingCycle: recurringBillingCycle,
    planName: assignedPlanForUsage?.name || org.subscription?.plan || 'Trial',
    basePlanPrice: basePlanRecurringPrice,
    recurringAddonPrice,
    recurringAddonCapacity: Math.max(0, Number(monthlyLeadAllowance.recurringLeadAllowance || 0)),
    totalRecurringPrice: basePlanRecurringPrice + recurringAddonPrice,
    currency: 'BDT' as const,
  }

  const scheduledPlan = org.subscription?.scheduledPlan || null
  const scheduledPlanVersion = org.subscription?.scheduledPlanVersion || null
  const scheduledBillingCycle = org.subscription?.scheduledBillingCycle || null
  const scheduledEffectiveAt = org.subscription?.scheduledEffectiveAt || null
  const scheduledChangeRequestId = org.subscription?.scheduledChangeRequestId ? String(org.subscription.scheduledChangeRequestId) : null
  const changeType = scheduledPlan ? 'downgrade' : (pendingChangeRequest?.changeType || null)

  return {
    plan: org.subscription?.plan || 'starter',
    currentPlan: org.subscription?.plan || 'starter',
    planVersion: org.subscription?.planVersion || 1,
    status: org.subscription?.status || 'trialing',
    currentPeriodEnd: org.subscription?.currentPeriodEnd,
    scheduledPlan,
    scheduledPlanVersion,
    scheduledBillingCycle,
    scheduledEffectiveAt,
    scheduledChangeRequestId,
    changeType,
    pendingChangeRequest,
    properties: { used: currentProperties, limit: maxProperties, percentage: propertiesPercent },
    maxTeamMembers,
    maxAddonLeadCapacity: (limits as any).maxAddonLeadCapacity === null ? null : Math.max(0, Number((limits as any).maxAddonLeadCapacity || 0)),
    teamMembersUsed: teamMemberQuota.teamMembersUsed,
    teamMembersReserved: teamMemberQuota.teamMembersReserved,
    teamMembersCommitted: teamMemberQuota.teamMembersCommitted,
    teamMembersAvailable: teamMemberQuota.teamMembersAvailable,
    teamMembersOverCapacityBy: teamMemberQuota.teamMembersOverCapacityBy,
    teamMembers: {
      used: teamMemberQuota.teamMembersUsed,
      reserved: teamMemberQuota.teamMembersReserved,
      committed: teamMemberQuota.teamMembersCommitted,
      available: teamMemberQuota.teamMembersAvailable,
      overCapacityBy: teamMemberQuota.teamMembersOverCapacityBy,
      limit: maxTeamMembers,
      percentage: teamMembersPercent,
    },
    leads: {
      used: currentLeads,
      accessible: currentLeads,
      locked: lockedLeads,
      total: totalLeadRecords,
      limit: maxLeads,
      remaining: Math.max(0, maxLeads - currentLeads),
      overCapacityBy: lockedLeads,
      percentage: leadsPercent,
    },
    leadAllowance,
    billingSummary,
    storage: { usedBytes: org.storageUsedBytes || 0, limitBytes: limits.maxStorageMb * 1024 * 1024 },
    visitors: { used: org.monthlyVisitorCount || 0, limit: limits.maxMonthlyVisitors, month: org.visitorUsageMonth },
    features: {
      customDomain: limits.hasCustomDomain,
      advancedAnalytics: limits.hasAdvancedAnalytics,
      whatsAppAutomation: limits.hasWhatsAppIntegration,
      smsAutomation: limits.hasSmsAutomation,
      premiumTemplates: limits.hasPremiumTemplates,
    },
    isApproachingLimit: propertiesPercent >= 80 || teamMembersPercent >= 80 || leadsPercent >= 80 || allowancePercent >= 80,
  }
}

const cancelScheduledDowngrade = async (organizationId: string, actorId: string) =>
  SubscriptionScheduleService.cancelScheduledChange(organizationId, {
    actorId,
    reason: 'Agency owner cancelled the scheduled downgrade before its billing boundary',
  })

const cancelSubscription = async (organizationId: string) => {
  const org = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const subscription: any = org.subscription
  if (!subscription) throw new ApiError(httpStatus.CONFLICT, 'Subscription state is unavailable')
  if (subscription.plan === 'trial') throw new ApiError(httpStatus.CONFLICT, 'Trial access does not require cancellation')
  if (subscription.scheduledPlan) {
    throw new ApiError(httpStatus.CONFLICT, 'A paid downgrade is already scheduled. Subscription cancellation requires an explicit billing adjustment/refund workflow first.')
  }

  // Idempotent cancellation. Critically, never convert an expired/grace/past-due
  // subscription back into cancel_at_period_end because that status remains
  // operationally accessible until its paid boundary.
  if (subscription.status === 'cancel_at_period_end' && subscription.cancelAtPeriodEnd) return subscription
  if (subscription.status !== 'active') {
    throw new ApiError(httpStatus.CONFLICT, 'Only an active paid subscription can be scheduled for cancellation')
  }
  if (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd).getTime() <= Date.now()) {
    throw new ApiError(httpStatus.CONFLICT, 'The paid billing period has already ended. Renew the subscription instead of cancelling it.')
  }

  subscription.status = 'cancel_at_period_end'
  subscription.cancelAtPeriodEnd = true
  subscription.revision = Math.max(0, Number(subscription.revision || 0)) + 1
  await org.save()
  return subscription
}

const getInvoiceReceipt = async (organizationId: string, id: string): Promise<GeneratedReceiptPdf> => {
  try {
    const receiptData = await SubscriptionPaymentService.getReceiptData(organizationId, id)
    return SubscriptionReceiptPdfService.generateSubscriptionReceiptPdf(receiptData)
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== httpStatus.NOT_FOUND) throw error
  }

  // Legacy Billing rows remain downloadable, but are normalized into the same PDF contract.
  const billing = await Billing.findOne({
    organizationId,
    status: 'paid',
    $or: [{ invoiceId: id }, ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : [])],
  }).select('+taxSnapshot.binEncrypted')

  if (!billing) throw new ApiError(httpStatus.NOT_FOUND, 'Billing invoice record not found')

  const org = await Organization.findOne({ organizationId }).select('agencyName email').lean() as any
  const tax = billing.taxSnapshot
  const taxEnabled = Boolean(tax?.invoiceEnabled && tax.registrationStatus === 'registered')
  const vatAmount = taxEnabled ? Math.max(0, Number(tax?.vatAmount || 0)) : 0
  const netAmount = taxEnabled && Number(tax?.netAmount || 0) > 0
    ? Number(tax?.netAmount || 0)
    : Math.max(0, Number(billing.amount || 0) - vatAmount)
  const bin = taxEnabled && tax?.binEncrypted ? decryptField(tax.binEncrypted) : ''
  const paidAt = (billing as any).billingDate || billing.createdAt || billing.date

  return SubscriptionReceiptPdfService.generateSubscriptionReceiptPdf({
    receiptNumber: billing.invoiceId,
    paymentNumber: billing.paymentId || billing.transactionId || billing.invoiceId,
    status: 'PAID',
    agencyName: org?.agencyName || 'Agency Customer',
    customerEmail: org?.email || '',
    planName: (billing as any).planName || billing.serviceName || 'SaaS Subscription',
    planVersion: billing.planVersion || null,
    billingCycle: billing.billingCycle,
    periodStart: paidAt || null,
    periodEnd: null,
    paymentMethod: billing.paymentMethod || 'manual',
    paymentReference: billing.transactionId || billing.paymentId || '',
    paidAt: paidAt || null,
    confirmedAt: paidAt || null,
    subtotal: netAmount,
    vatRate: taxEnabled ? Number(tax?.vatRate || 0) : 0,
    vatAmount,
    total: Number(billing.amount || 0),
    currency: billing.currency || 'BDT',
    taxOperatorLegalName: taxEnabled ? (tax?.operatorLegalName || null) : null,
    taxBin: bin || null,
  })
}


export const BillingService = {
  createBillingRecord,
  getBillingHistory,
  getSubscriptionUsage,
  cancelScheduledDowngrade,
  cancelSubscription,
  getInvoiceReceipt,
}
