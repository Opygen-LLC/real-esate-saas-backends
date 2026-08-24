import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { AuditEvent } from '../audit/audit.model'
import { AuthSession } from '../auth/authSession.model'
import { DomainRecord } from '../domain/domain.model'
import { activePipelineLeadFilter } from '../lead/leadStatus.contract'
import { Lead } from '../lead/lead.model'
import { LeadPurchaseRequest } from '../leadPurchaseRequest/leadPurchaseRequest.model'
import { LeadTopupGrant } from '../leadTopupGrant/leadTopupGrant.model'
import { LeadTopupGrantService } from '../leadTopupGrant/leadTopupGrant.service'
import { LeadAddonSubscriptionService } from '../leadAddonSubscription/leadAddonSubscription.service'
import { LeadAddonSubscription } from '../leadAddonSubscription/leadAddonSubscription.model'
import { MetaEvent } from '../metaIntegration/metaEvent.model'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { Organization } from '../organization/organization.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { Property } from '../property/property.model'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { SubscriptionBenefitStreakAdjustment } from '../subscriptionBenefitPeriod/subscriptionBenefitAdjustment.model'
import { SubscriptionChangeRequest } from '../subscriptionChangeRequest/subscriptionChangeRequest.model'
import { SubscriptionPayment } from '../subscriptionPayment/subscriptionPayment.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { effectivePermissionsForUser } from '../user/accessControl'
import { User } from '../user/user.model'
import { USER_PROFILE_POPULATES, toUserDto } from '../user/userProfile.service'
import { ImpersonationSession } from './impersonationSession.model'
import { resolveEntitlementSource } from '../entitlement/featureCatalog'
import { EntitlementService, propertyCountsTowardQuotaFilter } from '../entitlement/entitlement.service'
import { TenantEntitlementOverride } from '../tenantEntitlementOverride/tenantEntitlementOverride.model'

const TEAM_ROLES = ['agency_owner', 'agency_admin', 'agent', 'staff', 'viewer']

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const activeDomainTls = new Set(['active', 'issued', 'verified'])

const resolvePlanSnapshot = async (organization: any) => {
  if (organization.subscription?.plan === 'trial') {
    const policy: any = resolveEntitlementSource(await getTrialPolicy())
    return {
      kind: 'trial' as const,
      plan: null,
      displayName: 'Trial',
      priceMonthly: 0,
      priceYearly: 0,
      limits: {
        maxTeamMembers: number(policy.maxAgents),
        maxProperties: number(policy.maxProperties),
        maxLeads: number(policy.maxLeads),
        maxStorageMb: number(policy.maxStorageMb),
        maxMonthlyVisitors: number(policy.maxMonthlyVisitors),
        entitlements: policy.entitlements || {},
        hasCustomDomain: Boolean(policy.hasCustomDomain),
        hasAdvancedAnalytics: Boolean(policy.hasAdvancedAnalytics),
        hasWhatsAppIntegration: Boolean(policy.hasWhatsAppIntegration),
        hasSmsAutomation: Boolean(policy.hasSmsAutomation),
        hasPremiumTemplates: Boolean(policy.hasPremiumTemplates),
        hasLeadAutomations: Boolean(policy.hasLeadAutomations),
      },
    }
  }

  const exact: any = await SubscriptionPlan.findOne({
    planId: organization.subscription?.plan,
    version: organization.subscription?.planVersion,
  }).lean()
  const fallback: any = exact || await SubscriptionPlan.findOne({
    planId: organization.subscription?.plan,
    isCurrent: true,
    isActive: true,
  }).sort({ version: -1 }).lean()

  const plan: any = fallback ? resolveEntitlementSource(fallback) : null
  return {
    kind: 'paid' as const,
    plan: fallback,
    displayName: fallback?.name || String(organization.subscription?.plan || 'Unknown'),
    priceMonthly: number(fallback?.priceMonthly),
    priceYearly: number(fallback?.priceYearly),
    limits: {
      maxTeamMembers: number(plan?.maxAgents ?? organization.subscription?.maxAgents),
      maxProperties: number(plan?.maxProperties ?? organization.subscription?.maxProperties),
      maxLeads: number(plan?.maxLeads),
      maxStorageMb: number(plan?.maxStorageMb),
      maxMonthlyVisitors: number(plan?.maxMonthlyVisitors),
      entitlements: plan?.entitlements || {},
      hasCustomDomain: Boolean(plan?.hasCustomDomain),
      hasAdvancedAnalytics: Boolean(plan?.hasAdvancedAnalytics),
      hasWhatsAppIntegration: Boolean(plan?.hasWhatsAppIntegration),
      hasSmsAutomation: Boolean(plan?.hasSmsAutomation),
      hasPremiumTemplates: Boolean(plan?.hasPremiumTemplates),
      hasLeadAutomations: Boolean(plan?.hasLeadAutomations),
    },
  }
}

const categorizedAudit = (entries: any[]) => {
  const actionIncludes = (entry: any, needles: string[]) => needles.some((needle) => String(entry.action || '').toLowerCase().includes(needle))
  return {
    suspensionHistory: entries.filter((entry) => actionIncludes(entry, ['suspend', 'reactivat'])),
    planChanges: entries.filter((entry) => actionIncludes(entry, ['subscription.', 'plan_', 'plan.'])),
    adminOverrides: entries.filter((entry) => entry.actorRole === 'super-admin' && actionIncludes(entry, ['adjust', 'override', 'trial', 'subscription.'])),
    deletionArchiveEvents: entries.filter((entry) => actionIncludes(entry, ['delet', 'archiv', 'retention'])),
  }
}

export const getTenant360 = async (organizationId: string) => {
  const normalizedOrganizationId = String(organizationId || '').trim()
  if (!normalizedOrganizationId) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization is required')

  const organization: any = await Organization.findOne({ organizationId: normalizedOrganizationId }).lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const planSnapshot = await resolvePlanSnapshot(organization)
  const effectiveSnapshot = await EntitlementService.resolve(normalizedOrganizationId, undefined, { allowInactive: true, allowUnavailable: true })
  const now = new Date()

  const [
    users,
    pendingInvitations,
    activeBenefitPeriod,
    storedLeadCount,
    accessibleLeadCount,
    lockedLeadCount,
    propertyUsage,
    domain,
    payments,
    changeRequests,
    leadPurchaseRequests,
    topupGrants,
    recurringAddonSubscriptions,
    failedJobs,
    failedJobCount,
    deadMetaEvents,
    deadMetaEventCount,
    auditEntries,
    authSessions,
    impersonationSessions,
    tenantOverrideHistory,
  ]: any[] = await Promise.all([
    User.find({ organizationId: normalizedOrganizationId, userRole: { $in: TEAM_ROLES } })
      .select('_id name email phoneNumber organizationId userRole status accessRestriction isVerified createdAt updatedAt')
      .populate(USER_PROFILE_POPULATES)
      .sort({ userRole: 1, createdAt: 1, _id: 1 })
      .lean(),
    TeamInvitation.find({ organizationId: normalizedOrganizationId, status: 'pending', expiresAt: { $gt: now } })
      .select('_id email name phoneNumber userRole accessControl status invitedBy expiresAt createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .lean(),
    organization.subscription?.plan === 'trial' ? Promise.resolve(null) : SubscriptionBenefitPeriod.findOne({
      organizationId: normalizedOrganizationId,
      planId: organization.subscription?.plan,
      planVersion: organization.subscription?.planVersion,
      periodStart: { $lte: now },
      periodEnd: { $gt: now },
      $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }],
    }).sort({ periodStart: -1, _id: -1 }).lean(),
    Lead.countDocuments({ organizationId: normalizedOrganizationId, ...activePipelineLeadFilter() }),
    Lead.countDocuments({ organizationId: normalizedOrganizationId, ...activePipelineLeadFilter(), isLocked: { $ne: true } }),
    Lead.countDocuments({ organizationId: normalizedOrganizationId, ...activePipelineLeadFilter(), isLocked: true }),
    Property.countDocuments({ organizationId: normalizedOrganizationId, ...propertyCountsTowardQuotaFilter() }),
    DomainRecord.findOne({ organizationId: normalizedOrganizationId }).lean(),
    SubscriptionPayment.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
    SubscriptionChangeRequest.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
    LeadPurchaseRequest.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
    LeadTopupGrant.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
    LeadAddonSubscription.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
    OperationsJob.find({ organizationId: normalizedOrganizationId, status: 'failed' }).select('_id type entityId status attempts maxAttempts lastError updatedAt createdAt').sort({ updatedAt: -1, _id: -1 }).limit(20).lean(),
    OperationsJob.countDocuments({ organizationId: normalizedOrganizationId, status: 'failed' }),
    MetaEvent.find({ organizationId: normalizedOrganizationId, status: 'dead' }).select('_id eventName eventId status attempts lastErrorCode lastErrorMessage updatedAt createdAt').sort({ updatedAt: -1, _id: -1 }).limit(20).lean(),
    MetaEvent.countDocuments({ organizationId: normalizedOrganizationId, status: 'dead' }),
    AuditEvent.find({ organizationId: normalizedOrganizationId }).sort({ createdAt: -1, _id: -1 }).limit(100).lean(),
    AuthSession.find({ organizationId: normalizedOrganizationId }).select('_id userId expiresAt revokedAt revokeReason lastUsedAt lastUsedIp createdIp userAgent createdAt updatedAt').sort({ lastUsedAt: -1, _id: -1 }).limit(25).lean(),
    ImpersonationSession.find({ organizationId: normalizedOrganizationId }).select('_id adminUserId targetUserId reason readOnly startedAt expiresAt endedAt endedBy ip userAgent createdAt').sort({ startedAt: -1, _id: -1 }).limit(20).lean(),
    TenantEntitlementOverride.find({ organizationId: normalizedOrganizationId }).sort({ version: -1, _id: -1 }).limit(20).lean(),
  ])

  const benefitAdjustment: any = activeBenefitPeriod
    ? await SubscriptionBenefitStreakAdjustment.findOne({ organizationId: normalizedOrganizationId, benefitPeriodId: String(activeBenefitPeriod._id) }).sort({ createdAt: -1, _id: -1 }).lean()
    : null
  const activeTopupSummary = activeBenefitPeriod
    ? await LeadTopupGrantService.getActiveGrantSummary(normalizedOrganizationId, activeBenefitPeriod._id)
    : { topupLeadAllowance: 0, grantCount: 0 }
  const activeRecurringAddonSummary = organization.subscription?.plan === 'trial'
    ? { recurringLeadAllowance: 0, recurringAddonPriceMonthly: 0, recurringAddonCyclePrice: 0, count: 0 }
    : await LeadAddonSubscriptionService.getActiveSummary(normalizedOrganizationId)

  const team = users.map((user: any) => toUserDto(user, { includeAccessControl: true, includePermissions: true }))
  const userById = new Map(team.map((user: any) => [String(user._id), user]))
  const owner = team.find((user: any) => String(user._id) === String(organization.ownerId || ''))
    || team.find((user: any) => user.userRole === 'agency_owner')
    || null

  const invitationRows = pendingInvitations.map((invitation: any) => ({
    ...invitation,
    permissions: effectivePermissionsForUser({
      userRole: invitation.userRole,
      accessControl: invitation.accessControl || { useRoleDefaults: true, permissions: [] },
    }),
  }))

  const activeTeamMembers = team.filter((member: any) => member.status === 'active').length
  const pendingTeamMembers = team.filter((member: any) => member.status === 'pending').length
  const blockedTeamMembers = team.filter((member: any) => member.status === 'blocked').length
  const seatMembersUsed = team.filter((member: any) => member.status !== 'blocked').length
  const teamLimit = number(effectiveSnapshot.limits.maxTeamMembers)
  const seatCommitted = seatMembersUsed + invitationRows.length

  const benefit: any = activeBenefitPeriod || null
  const grantedRenewalStreak = number(benefit?.renewalStreak)
  const currentRenewalStreak = benefitAdjustment ? Math.max(1, number(benefitAdjustment.adjustedRenewalStreak)) : grantedRenewalStreak
  const planLeadAllowance = organization.subscription?.plan === 'trial'
    ? number(planSnapshot.limits.maxLeads)
    : number(benefit?.totalLeadAllowance ?? planSnapshot.limits.maxLeads)
  const loyaltyCapacity = benefit ? Math.max(0, number(benefit.bonusLeadAllowance)) : 0
  const basePlanCapacity = benefit ? Math.max(0, number(benefit.baseLeadAllowance)) : number(planSnapshot.limits.maxLeads)
  const purchasedTopupCapacity = number(activeTopupSummary.topupLeadAllowance)
  const recurringAddonCapacity = number(activeRecurringAddonSummary.recurringLeadAllowance)
  const effectiveLeadCapacity = number(effectiveSnapshot.limits.maxLeads)
  const adminAdjustmentCapacity = effectiveLeadCapacity - (planLeadAllowance + purchasedTopupCapacity + recurringAddonCapacity)

  const latestConfirmedPayment: any = payments.find((payment: any) => payment.status === 'confirmed' && ['monthly', 'yearly'].includes(payment.billingCycle)) || null
  const currentBillingCycle = benefit?.billingCycle === 'yearly'
    ? 'yearly'
    : benefit?.billingCycle === 'monthly'
      ? 'monthly'
      : latestConfirmedPayment?.billingCycle === 'yearly'
        ? 'yearly'
        : latestConfirmedPayment?.billingCycle === 'monthly'
          ? 'monthly'
          : null
  const currentCycleAmount = currentBillingCycle === 'yearly' ? planSnapshot.priceYearly : currentBillingCycle === 'monthly' ? planSnapshot.priceMonthly : 0
  const monthlyRecurringAmount = planSnapshot.priceMonthly + number(activeRecurringAddonSummary.recurringAddonPriceMonthly)

  const operationalErrors = [
    ...failedJobs.map((row: any) => ({ source: 'operations_job', id: String(row._id), type: row.type, message: row.lastError || 'Operation failed', at: row.updatedAt || row.createdAt })),
    ...deadMetaEvents.map((row: any) => ({ source: 'meta_event', id: String(row._id), type: row.eventName, message: row.lastErrorMessage || row.lastErrorCode || 'Meta event delivery failed', at: row.updatedAt || row.createdAt })),
    ...((domain?.status === 'failed' || domain?.tlsStatus === 'failed') ? [{ source: 'domain', id: String(domain._id), type: 'domain_tls', message: domain.failureReason || `${domain.status}/${domain.tlsStatus}`, at: domain.updatedAt || domain.lastCheckedAt }] : []),
  ].sort((a: any, b: any) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())

  const errorCount = number(failedJobCount) + number(deadMetaEventCount) + ((domain?.status === 'failed' || domain?.tlsStatus === 'failed') ? 1 : 0)
  const subscriptionNeedsAttention = ['past_due', 'grace', 'expired'].includes(String(organization.subscription?.status || ''))
  const accessStatus = ['active', 'suspended', 'archived', 'pending_deletion'].includes(String(organization.platformAccess?.status || ''))
    ? String(organization.platformAccess.status)
    : (organization.isBlocked ? 'suspended' : 'active')
  const health = accessStatus === 'archived'
    ? 'archived'
    : accessStatus === 'pending_deletion'
      ? 'pending_deletion'
      : accessStatus === 'suspended'
        ? 'suspended'
        : (errorCount > 0 || subscriptionNeedsAttention ? 'attention' : 'healthy')

  const summarizedUser = (value: unknown) => {
    const user: any = userById.get(String(value || ''))
    return user ? { _id: user._id, name: user.name, email: user.email, userRole: user.userRole } : null
  }
  const categorized = categorizedAudit(auditEntries)
  const recentSessions = authSessions.map((session: any) => ({
    ...session,
    user: summarizedUser(session.userId),
  }))

  const topupGrantByRequest = new Map(topupGrants.map((grant: any) => [String(grant.approvedRequestId), grant]))
  const addOnPayments = leadPurchaseRequests.map((request: any) => ({
    ...request,
    grant: topupGrantByRequest.get(String(request._id)) || null,
  }))

  return {
    overview: {
      organizationId: organization.organizationId,
      _id: organization._id,
      agencyName: organization.agencyName,
      agencyType: organization.agencyType,
      email: organization.email,
      phone: organization.phone,
      licenseNumber: organization.licenseNumber || '',
      address: organization.address || '',
      city: organization.city || '',
      state: organization.state || '',
      country: organization.country || '',
      zipCode: organization.zipCode || '',
      defaultLanguage: organization.defaultLanguage || 'en',
      addressDetails: organization.addressDetails || {},
      operationalSettings: organization.teamSettings || {},
      location: [organization.city, organization.state, organization.country].filter(Boolean).join(', '),
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      accountAgeDays: Math.max(0, Math.floor((Date.now() - new Date(organization.createdAt || Date.now()).getTime()) / 86_400_000)),
      status: accessStatus,
      isBlocked: Boolean(organization.isBlocked),
      platformAccess: organization.platformAccess || { status: accessStatus },
      health,
      currentPlan: organization.subscription?.plan || 'trial',
      currentPlanName: planSnapshot.displayName,
      planVersion: organization.subscription?.planVersion || 1,
      subscriptionStatus: organization.subscription?.status || 'trialing',
      websiteStatus: organization.websiteStatus || 'provisioned',
      operationalErrorCount: errorCount,
    },
    ownerAndTeam: {
      owner,
      teamMembers: team,
      pendingInvitations: invitationRows,
      counts: {
        totalMembers: team.length,
        activeMembers: activeTeamMembers,
        pendingMembers: pendingTeamMembers,
        blockedMembers: blockedTeamMembers,
        pendingInvitations: invitationRows.length,
      },
      seatUsage: {
        used: seatMembersUsed,
        reserved: invitationRows.length,
        committed: seatCommitted,
        limit: teamLimit,
        available: Math.max(0, teamLimit - seatCommitted),
        overCapacityBy: Math.max(0, seatCommitted - teamLimit),
      },
    },
    subscriptionAndEntitlements: {
      currentPlan: organization.subscription?.plan || 'trial',
      currentPlanName: planSnapshot.displayName,
      planVersion: organization.subscription?.planVersion || 1,
      planDocumentId: planSnapshot.plan?._id || null,
      billingCycle: currentBillingCycle,
      periodStart: benefit?.periodStart || latestConfirmedPayment?.periodStart || null,
      periodEnd: benefit?.periodEnd || organization.subscription?.currentPeriodEnd || null,
      currentPeriodEnd: organization.subscription?.currentPeriodEnd || null,
      trialEndsAt: organization.subscription?.trialEndsAt || null,
      renewalStreak: currentRenewalStreak,
      cancellation: {
        cancelAtPeriodEnd: Boolean(organization.subscription?.cancelAtPeriodEnd),
        status: organization.subscription?.status || 'trialing',
      },
      scheduledDowngrade: organization.subscription?.scheduledPlan ? {
        plan: organization.subscription.scheduledPlan,
        planVersion: organization.subscription.scheduledPlanVersion,
        billingCycle: organization.subscription.scheduledBillingCycle,
        effectiveAt: organization.subscription.scheduledEffectiveAt,
        changeRequestId: organization.subscription.scheduledChangeRequestId,
        source: organization.subscription.scheduledSource,
      } : null,
      planLimits: planSnapshot.limits,
      loyalty: benefit ? {
        model: benefit.leadAllowanceModel,
        baseLeadAllowance: number(benefit.baseLeadAllowance),
        bonusLeadAllowance: number(benefit.bonusLeadAllowance),
        totalLeadAllowance: number(benefit.totalLeadAllowance),
        renewalBonusEnabled: Boolean(benefit.renewalBonusEnabled),
        renewalLeadBonus: number(benefit.renewalLeadBonus),
        maxRenewalLeadBonus: number(benefit.maxRenewalLeadBonus),
        grantedRenewalStreak,
        currentRenewalStreak,
        adjustment: benefitAdjustment || null,
      } : null,
      addOns: {
        currentTopupCapacity: purchasedTopupCapacity,
        activeGrantCount: number(activeTopupSummary.grantCount),
        grants: topupGrants,
        purchaseRequests: leadPurchaseRequests,
        recurringAddOnsSupported: true,
        recurringLeadCapacity: recurringAddonCapacity,
        recurringAddonPriceMonthly: number(activeRecurringAddonSummary.recurringAddonPriceMonthly),
        activeRecurringAddonCount: number(activeRecurringAddonSummary.count),
        recurringSubscriptions: recurringAddonSubscriptions,
      },
      tenantOverrides: {
        supported: true,
        active: effectiveSnapshot.limits.tenantOverride || null,
        items: tenantOverrideHistory,
        note: 'Tenant-specific overrides are applied after plan, loyalty, recurring add-ons and legacy top-up grants.',
      },
      effectiveLimits: {
        ...planSnapshot.limits,
        maxTeamMembers: number(effectiveSnapshot.limits.maxTeamMembers),
        maxProperties: number(effectiveSnapshot.limits.maxProperties),
        maxLeads: effectiveLeadCapacity,
        maxStorageMb: number(effectiveSnapshot.limits.maxStorageMb),
        maxMonthlyVisitors: number(effectiveSnapshot.limits.maxMonthlyVisitors),
        hasCustomDomain: Boolean(effectiveSnapshot.limits.hasCustomDomain),
        hasAdvancedAnalytics: Boolean(effectiveSnapshot.limits.hasAdvancedAnalytics),
        hasWhatsAppIntegration: Boolean(effectiveSnapshot.limits.hasWhatsAppIntegration),
        hasSmsAutomation: Boolean(effectiveSnapshot.limits.hasSmsAutomation),
        hasPremiumTemplates: Boolean(effectiveSnapshot.limits.hasPremiumTemplates),
        hasLeadAutomations: Boolean(effectiveSnapshot.limits.hasLeadAutomations),
      },
    },
    leadCapacity: {
      basePlanCapacity,
      loyaltyCapacity,
      planLeadAllowance,
      recurringLeadAddonCapacity: recurringAddonCapacity,
      purchasedTopupCapacity,
      adminAdjustmentCapacity,
      effectiveCapacity: effectiveLeadCapacity,
      storedLeads: storedLeadCount,
      accessibleLeads: accessibleLeadCount,
      lockedLeads: lockedLeadCount,
      remainingCapacity: Math.max(0, effectiveLeadCapacity - accessibleLeadCount),
      overCapacityBy: Math.max(0, storedLeadCount - effectiveLeadCapacity),
      activeBenefitPeriodId: benefit?._id || null,
    },
    billing: {
      currency: 'BDT',
      monthlyRecurringAmount,
      currentCycleAmount,
      currentBillingCycle,
      upcomingRenewal: organization.subscription?.plan === 'trial' ? null : {
        at: organization.subscription?.currentPeriodEnd || benefit?.periodEnd || null,
        expectedAmount: (currentBillingCycle === 'yearly' ? planSnapshot.priceYearly : planSnapshot.priceMonthly) + number(activeRecurringAddonSummary.recurringAddonCyclePrice),
        currency: 'BDT',
      },
      payments,
      receipts: payments.filter((payment: any) => payment.receiptNumber).map((payment: any) => ({
        paymentId: payment._id,
        paymentNumber: payment.paymentNumber,
        receiptNumber: payment.receiptNumber,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
        confirmedAt: payment.confirmedAt,
      })),
      subscriptionRequests: changeRequests,
      addOnPayments,
      recurringAddons: recurringAddonSubscriptions,
    },
    websiteAndDomain: {
      subdomain: organization.sub_domain || '',
      canonicalDomain: organization.domain || '',
      customDomain: domain ? {
        domain: domain.domain,
        lifecycleStatus: domain.lifecycleStatus,
        status: domain.status,
        tlsStatus: domain.tlsStatus,
        entitlementStatus: domain.entitlementStatus,
        provider: domain.provider,
        publicRoutingStatus: domain.publicRoutingStatus,
        providerRegistrationStatus: domain.providerRegistrationStatus,
        failureReason: domain.failureReason,
        diagnostics: domain.diagnostics || [],
        lastCheckedAt: domain.lastCheckedAt,
        candidate: domain.candidate || null,
      } : null,
      websiteStatus: organization.websiteStatus || 'provisioned',
      templateId: organization.templateId || 'template-1',
      domainVerified: Boolean(organization.domain_Verify),
      operationalErrors,
    },
    securityAndAudit: {
      recentLogins: recentSessions,
      suspensionHistory: categorized.suspensionHistory,
      planChanges: categorized.planChanges,
      adminOverrides: categorized.adminOverrides,
      deletionArchiveEvents: categorized.deletionArchiveEvents,
      supportImpersonation: impersonationSessions.map((session: any) => ({
        ...session,
        targetUser: summarizedUser(session.targetUserId),
      })),
      auditHistory: auditEntries,
    },
    usage: {
      properties: propertyUsage,
      teamMembers: seatMembersUsed,
      pendingInvitations: invitationRows.length,
      leads: storedLeadCount,
      storageUsedBytes: number(organization.storageUsedBytes),
      monthlyVisitors: number(organization.monthlyVisitorCount),
    },
    metadata: {
      generatedAt: new Date(),
      customDomainHealthy: !domain || (domain.status === 'verified' && activeDomainTls.has(String(domain.tlsStatus || '').toLowerCase())),
      tenantOverridesAvailable: true,
      recurringLeadAddOnsAvailable: true,
    },
  }
}
