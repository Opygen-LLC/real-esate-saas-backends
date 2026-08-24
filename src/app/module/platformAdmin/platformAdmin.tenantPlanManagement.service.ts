import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { publishSubscriptionEntitlementReconciliation, reconcileOrganizationEntitlements } from '../entitlement/subscriptionEntitlementReconciliation.service'
import { LeadAddonSubscriptionService } from '../leadAddonSubscription/leadAddonSubscription.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionBenefitPeriodService } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { resolvePlanLeadPolicy, toBenefitPlanSnapshot } from '../subscriptionPlan/planLeadPolicy'
import { classifySubscriptionChange, SubscriptionScheduleService } from '../subscription/subscriptionSchedule.service'
import { SubscriptionQuoteService } from '../subscription/subscriptionQuote.service'
import { TenantEntitlementOverrideService, type TenantEntitlementOverrideInput } from '../tenantEntitlementOverride/tenantEntitlementOverride.service'
import { writeAudit } from '../audit/audit.service'

type Actor = { id: string; requestId?: string; ip?: string }
type BillingCycle = 'monthly' | 'yearly'

const adminReference = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

const planByVersion = async (planId: string, version?: number) => {
  const query: any = { planId, isActive: true }
  if (version) query.version = version
  else query.isCurrent = true
  const plan: any = await SubscriptionPlan.findOne(query).lean()
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan version not found')
  return resolvePlanLeadPolicy(plan)
}

const effectiveInput = (resolved: any) => ({
  plan: String(resolved.organization.subscription?.plan || 'trial'),
  planVersion: Number(resolved.organization.subscription?.planVersion || 1),
  maxTeamMembers: Number(resolved.limits.maxTeamMembers || 0),
  maxProperties: Number(resolved.limits.maxProperties || 0),
  maxLeads: Number(resolved.limits.maxLeads || 0),
  maxStorageMb: Number(resolved.limits.maxStorageMb || 0),
  leadAllowanceModel: resolved.limits.leadAllowanceModel === 'active_capacity' ? 'active_capacity' as const : 'paid_period_credits' as const,
  hasCustomDomain: Boolean(resolved.limits.hasCustomDomain), hasAdvancedAnalytics: Boolean(resolved.limits.hasAdvancedAnalytics),
  hasWhatsAppIntegration: Boolean(resolved.limits.hasWhatsAppIntegration), hasSmsAutomation: Boolean(resolved.limits.hasSmsAutomation),
  hasPremiumTemplates: Boolean(resolved.limits.hasPremiumTemplates), hasLeadAutomations: Boolean(resolved.limits.hasLeadAutomations),
  tenantOverrideApplied: true,
})

const applyNoChargePlanOverride = async (
  organizationId: string,
  input: { planId: string; planVersion?: number; billingCycle: BillingCycle; reason: string },
  actor: Actor,
) => {
  const target = await planByVersion(input.planId, input.planVersion)
  await LeadAddonSubscriptionService.assertPlanCeiling(organizationId, Number(target.maxRecurringLeadAddon || 0))
  let response: any = null
  let reconciliation: any = null
  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    const orgQuery = Organization.findOne({ organizationId })
    if (session) orgQuery.session(session)
    const org: any = await orgQuery
    if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
    if (org.isBlocked || ['archived', 'pending_deletion'].includes(String(org.platformAccess?.status || ''))) throw new ApiError(httpStatus.CONFLICT, 'Restore/reactivate this agency before applying a plan override')
    if (org.subscription?.scheduledPlan) throw new ApiError(httpStatus.CONFLICT, 'Cancel the existing scheduled plan change before applying an immediate administrative override')

    const before = await EntitlementService.resolve(organizationId, session, { allowInactive: true })
    const previous = org.subscription?.toObject?.() || { ...(org.subscription || {}) }
    const now = new Date()
    const existingEnd = org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd) : null
    const preserveBoundary = org.subscription?.plan !== 'trial' && existingEnd && existingEnd > now && ['active', 'grace', 'cancel_at_period_end'].includes(String(org.subscription?.status || ''))
    const end = preserveBoundary ? existingEnd : SubscriptionQuoteService.addBillingCycle(now, input.billingCycle)

    org.subscription = {
      ...(org.subscription?.toObject?.() || org.subscription || {}),
      plan: target.planId, planVersion: target.version, status: 'active', currentPeriodEnd: end,
      trialEndsAt: null, gracePeriodEnd: null, cancelAtPeriodEnd: false, reminderSentAt: null, source: 'manual_admin',
      maxProperties: Number(target.maxProperties || 0), maxAgents: Number(target.maxAgents ?? target.maxTeamMembers ?? 0),
      scheduledPlan: null, scheduledPlanVersion: null, scheduledBillingCycle: null, scheduledEffectiveAt: null,
      scheduledChangeRequestId: null, scheduledBy: null, scheduledSource: null,
      revision: Math.max(0, Number(org.subscription?.revision || 0)) + 1,
    }
    await org.save(session ? { session } : undefined)

    const sameAssignedVersion = String(previous.plan || '') === String(target.planId) && Number(previous.planVersion || 1) === Number(target.version)
    const activeBenefitQuery = SubscriptionBenefitPeriod.findOne({ organizationId, planId: target.planId, planVersion: target.version, periodStart: { $lte: now }, periodEnd: { $gt: now }, $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }] }).select('_id')
    if (session) activeBenefitQuery.session(session)
    const activeBenefit = sameAssignedVersion ? await activeBenefitQuery.lean() : null
    if (!activeBenefit) await SubscriptionBenefitPeriodService.createForPaidSubscription({
      organizationId, paymentSource: 'manual_admin', paymentNumber: adminReference('ADMIN-PLAN'), billingCycle: input.billingCycle,
      periodStart: now, periodEnd: end, continuityMode: 'reset', plan: toBenefitPlanSnapshot(target),
    }, session)

    const after = await EntitlementService.resolve(organizationId, session, { allowInactive: true })
    reconciliation = await reconcileOrganizationEntitlements(organizationId, effectiveInput(before), effectiveInput(after), { session, actorId: actor.id, reason: `Administrative no-charge plan override to ${target.planId} v${target.version}` })
    await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.admin_plan_override_applied', entityType: 'organization', entityId: String(org._id), reason: input.reason, requestId: actor.requestId, ip: actor.ip, metadata: { noCharge: true, previous, target: { planId: target.planId, planVersion: target.version, billingCycle: input.billingCycle }, preservedRenewalBoundary: preserveBoundary, currentPeriodEnd: end, reconciliation } }, session)
    response = { organizationId, plan: target.planId, planVersion: target.version, billingCycle: input.billingCycle, currentPeriodEnd: end, noCharge: true, reconciliation }
  })
  await publishSubscriptionEntitlementReconciliation(reconciliation)
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'admin_plan_override', entityId: organizationId })
  return response
}

const scheduleNoChargeDowngrade = async (
  organizationId: string,
  input: { planId: string; planVersion?: number; billingCycle: BillingCycle; reason: string },
  actor: Actor,
) => {
  const target = await planByVersion(input.planId, input.planVersion)
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.subscription?.plan === 'trial') throw new ApiError(httpStatus.CONFLICT, 'Trial accounts do not have a paid downgrade boundary')
  const changeType = await classifySubscriptionChange(String(org.subscription.plan), String(target.planId), { currentPlanVersion: Number(org.subscription.planVersion || 1), requestedPlanVersion: Number(target.version || 1) })
  if (changeType !== 'downgrade') throw new ApiError(httpStatus.CONFLICT, 'Only a lower-ranked plan can be scheduled as a downgrade. Use the immediate administrative override for corrections/upgrades.')
  const effectiveAt = org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd) : null
  if (!effectiveAt || effectiveAt <= new Date()) throw new ApiError(httpStatus.CONFLICT, 'This agency has no future paid billing boundary for a scheduled downgrade')
  await LeadAddonSubscriptionService.assertPlanCeiling(organizationId, Number(target.maxRecurringLeadAddon || 0))

  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    const orgQuery = Organization.findOne({ organizationId })
    if (session) orgQuery.session(session)
    const locked: any = await orgQuery
    if (!locked) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
    const end = SubscriptionQuoteService.addBillingCycle(effectiveAt, input.billingCycle)
    await SubscriptionBenefitPeriodService.createForPaidSubscription({
      organizationId, paymentSource: 'manual_admin', paymentNumber: adminReference('ADMIN-SCHEDULE'), billingCycle: input.billingCycle,
      periodStart: effectiveAt, periodEnd: end, continuityMode: 'reset', plan: toBenefitPlanSnapshot(target),
    }, session)
    await SubscriptionScheduleService.scheduleDowngradeOnOrganization(locked, { planId: target.planId, planVersion: target.version, billingCycle: input.billingCycle, effectiveAt, scheduledBy: actor.id, source: 'manual_admin' }, session)
    await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.admin_downgrade_scheduled', entityType: 'organization', entityId: String(locked._id), reason: input.reason, requestId: actor.requestId, ip: actor.ip, metadata: { noCharge: true, targetPlan: target.planId, targetPlanVersion: target.version, billingCycle: input.billingCycle, effectiveAt } }, session)
  })
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'admin_downgrade_scheduled', entityId: organizationId })
  return { organizationId, plan: target.planId, planVersion: target.version, billingCycle: input.billingCycle, effectiveAt, noCharge: true }
}

const cancelScheduledChange = async (organizationId: string, reason: string, actor: Actor) => SubscriptionScheduleService.cancelScheduledChange(organizationId, { actorId: actor.id, actorRole: 'super-admin', reason })

const setCancellation = async (organizationId: string, cancelAtPeriodEnd: boolean, reason: string, actor: Actor) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.subscription?.plan === 'trial') throw new ApiError(httpStatus.CONFLICT, 'Trial accounts do not use paid cancellation-at-period-end')
  if (!['active', 'cancel_at_period_end'].includes(String(org.subscription?.status || ''))) throw new ApiError(httpStatus.CONFLICT, 'Only an active paid subscription can change cancellation-at-period-end')
  const previous = { cancelAtPeriodEnd: Boolean(org.subscription.cancelAtPeriodEnd), status: org.subscription.status }
  org.subscription.cancelAtPeriodEnd = cancelAtPeriodEnd
  org.subscription.status = cancelAtPeriodEnd ? 'cancel_at_period_end' : 'active'
  org.subscription.revision = Math.max(0, Number(org.subscription.revision || 0)) + 1
  await org.save()
  await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: cancelAtPeriodEnd ? 'subscription.admin_cancellation_scheduled' : 'subscription.admin_cancellation_removed', entityType: 'organization', entityId: String(org._id), reason, requestId: actor.requestId, ip: actor.ip, metadata: { previous, currentPeriodEnd: org.subscription.currentPeriodEnd } })
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: cancelAtPeriodEnd ? 'cancel_at_period_end' : 'cancellation_removed', entityId: organizationId })
  return { organizationId, cancelAtPeriodEnd, status: org.subscription.status, currentPeriodEnd: org.subscription.currentPeriodEnd }
}

const requestRecurringAddon = async (organizationId: string, input: { definitionId: string; quoteCalculatedAt?: string; reason: string }, actor: Actor) => LeadAddonSubscriptionService.createAdminSubscriptionRequest(organizationId, actor.id, input)
const getTenantOverrides = (organizationId: string) => TenantEntitlementOverrideService.getHistory(organizationId)
const setTenantOverride = (organizationId: string, input: TenantEntitlementOverrideInput, actor: Actor) => TenantEntitlementOverrideService.createOrReplace(organizationId, input, actor)
const revokeTenantOverride = (organizationId: string, reason: string, actor: Actor) => TenantEntitlementOverrideService.revoke(organizationId, reason, actor)

export const PlatformAdminTenantPlanManagementService = { applyNoChargePlanOverride, scheduleNoChargeDowngrade, cancelScheduledChange, setCancellation, requestRecurringAddon, getTenantOverrides, setTenantOverride, revokeTenantOverride }
