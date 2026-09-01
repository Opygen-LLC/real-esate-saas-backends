import type { ClientSession } from 'mongoose'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { resolvePlanLeadPolicy } from '../subscriptionPlan/planLeadPolicy'
import {
  publishResourceEntitlementReconciliation,
  reconcileResourceEntitlements,
  type ResourceEntitlementReconciliationResult,
  type ResourceEntitlementSnapshot,
} from './resourceEntitlementReconciliation.service'
import { publishTeamSeatReconciliation, reconcileTeamSeats, type TeamSeatReconciliationResult } from './teamSeatReconciliation.service'
import { applyTenantEntitlementOverride, getActiveTenantEntitlementOverride } from '../tenantEntitlementOverride/tenantEntitlementOverride.resolver'

export interface SubscriptionEntitlementInput {
  plan?: string
  planId?: string
  planVersion?: number
  version?: number
  maxAgents?: number
  maxTeamMembers?: number
  maxProperties?: number
  maxLeads?: number
  leadAllowanceModel?: 'active_capacity' | 'paid_period_credits'
  maxStorageMb?: number
  hasCustomDomain?: boolean
  hasAdvancedAnalytics?: boolean
  hasWhatsAppIntegration?: boolean
  hasSmsAutomation?: boolean
  hasPremiumTemplates?: boolean
  hasLeadAutomations?: boolean
  hasAdvancedAccounting?: boolean
  /** Internal marker: the input already contains tenant-specific override effects. */
  tenantOverrideApplied?: boolean
}

export interface SubscriptionEntitlementSnapshot extends ResourceEntitlementSnapshot {
  maxTeamMembers: number
}

export interface SubscriptionEntitlementReconciliationResult {
  organizationId: string
  direction: 'upgrade' | 'downgrade' | 'unchanged'
  previous: SubscriptionEntitlementSnapshot
  current: SubscriptionEntitlementSnapshot
  teamSeats: TeamSeatReconciliationResult
  resources: ResourceEntitlementReconciliationResult
}

const finiteNonNegative = (value: unknown): number | undefined => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined
}

const booleanOrUndefined = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined

const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

const resolveCatalogPolicy = async (input: SubscriptionEntitlementInput | null | undefined, session?: ClientSession) => {
  const plan = String(input?.plan ?? input?.planId ?? 'unknown')
  const planVersion = Math.max(1, finiteNonNegative(input?.planVersion ?? input?.version) ?? 1)
  if (plan === 'trial') {
    const policy = await getTrialPolicy()
    return {
      plan,
      planVersion: 1,
      maxAgents: Number(policy.maxAgents || 0),
      maxProperties: Number(policy.maxProperties || 0),
      maxLeads: Number(policy.maxLeads || 0),
      leadAllowanceModel: 'paid_period_credits' as const,
      maxStorageMb: Number(policy.maxStorageMb || 0),
      hasCustomDomain: Boolean(policy.hasCustomDomain),
      hasAdvancedAnalytics: Boolean(policy.hasAdvancedAnalytics),
      hasWhatsAppIntegration: Boolean(policy.hasWhatsAppIntegration),
      hasSmsAutomation: Boolean(policy.hasSmsAutomation),
      hasPremiumTemplates: Boolean(policy.hasPremiumTemplates),
      hasLeadAutomations: Boolean(policy.hasLeadAutomations),
      hasAdvancedAccounting: Boolean(policy.hasAdvancedAccounting),
    }
  }

  const exact = await withSession(SubscriptionPlan.findOne({ planId: plan, version: planVersion }), session).lean()
  if (exact) return resolvePlanLeadPolicy(exact as any)
  const current = await withSession(SubscriptionPlan.findOne({ planId: plan, isCurrent: true }).sort({ version: -1 }), session).lean() as any
  return current ? resolvePlanLeadPolicy(current) : { plan, planVersion }
}

export const resolveSubscriptionEntitlementSnapshot = async (
  input: SubscriptionEntitlementInput | null | undefined,
  session?: ClientSession,
  fallback?: SubscriptionEntitlementSnapshot,
): Promise<SubscriptionEntitlementSnapshot> => {
  const catalog: any = await resolveCatalogPolicy(input, session)
  const plan = String(input?.plan ?? input?.planId ?? catalog?.planId ?? catalog?.plan ?? fallback?.plan ?? 'unknown')
  const planVersion = Math.max(1, finiteNonNegative(input?.planVersion ?? input?.version ?? catalog?.version ?? catalog?.planVersion ?? fallback?.planVersion) ?? 1)
  const maxTeamMembers = finiteNonNegative(input?.maxTeamMembers ?? input?.maxAgents ?? catalog?.maxAgents ?? catalog?.maxTeamMembers ?? fallback?.maxTeamMembers)
  if (maxTeamMembers === undefined) throw new Error('Effective subscription is missing a valid team-member limit')

  return {
    plan,
    planVersion,
    maxTeamMembers: Math.max(1, maxTeamMembers),
    maxProperties: finiteNonNegative(input?.maxProperties ?? catalog?.maxProperties ?? fallback?.maxProperties) ?? 0,
    maxLeads: finiteNonNegative(input?.maxLeads ?? catalog?.maxLeads ?? fallback?.maxLeads) ?? 0,
    leadAllowanceModel: (input?.leadAllowanceModel ?? catalog?.leadAllowanceModel ?? fallback?.leadAllowanceModel) === 'active_capacity'
      ? 'active_capacity'
      : 'paid_period_credits',
    maxStorageMb: finiteNonNegative(input?.maxStorageMb ?? catalog?.maxStorageMb ?? fallback?.maxStorageMb) ?? 0,
    hasCustomDomain: booleanOrUndefined(input?.hasCustomDomain) ?? booleanOrUndefined(catalog?.hasCustomDomain) ?? fallback?.hasCustomDomain ?? false,
    hasAdvancedAnalytics: booleanOrUndefined(input?.hasAdvancedAnalytics) ?? booleanOrUndefined(catalog?.hasAdvancedAnalytics) ?? fallback?.hasAdvancedAnalytics ?? false,
    hasWhatsAppIntegration: booleanOrUndefined(input?.hasWhatsAppIntegration) ?? booleanOrUndefined(catalog?.hasWhatsAppIntegration) ?? fallback?.hasWhatsAppIntegration ?? false,
    hasSmsAutomation: booleanOrUndefined(input?.hasSmsAutomation) ?? booleanOrUndefined(catalog?.hasSmsAutomation) ?? fallback?.hasSmsAutomation ?? false,
    hasPremiumTemplates: booleanOrUndefined(input?.hasPremiumTemplates) ?? booleanOrUndefined(catalog?.hasPremiumTemplates) ?? fallback?.hasPremiumTemplates ?? false,
    hasLeadAutomations: booleanOrUndefined(input?.hasLeadAutomations) ?? booleanOrUndefined(catalog?.hasLeadAutomations) ?? fallback?.hasLeadAutomations ?? false,
    hasAdvancedAccounting: booleanOrUndefined(input?.hasAdvancedAccounting) ?? booleanOrUndefined(catalog?.hasAdvancedAccounting) ?? fallback?.hasAdvancedAccounting ?? ['agency', 'enterprise'].includes(plan.toLowerCase()),
  }
}

const hasDowngrade = (previous: SubscriptionEntitlementSnapshot, current: SubscriptionEntitlementSnapshot) =>
  current.maxTeamMembers < previous.maxTeamMembers
  || current.maxProperties < previous.maxProperties
  || current.maxLeads < previous.maxLeads
  || current.maxStorageMb < previous.maxStorageMb
  || (previous.hasCustomDomain && !current.hasCustomDomain)
  || (previous.hasAdvancedAnalytics && !current.hasAdvancedAnalytics)
  || (previous.hasWhatsAppIntegration && !current.hasWhatsAppIntegration)
  || (previous.hasSmsAutomation && !current.hasSmsAutomation)
  || (previous.hasPremiumTemplates && !current.hasPremiumTemplates)
  || (previous.hasLeadAutomations && !current.hasLeadAutomations)
  || (previous.hasAdvancedAccounting && !current.hasAdvancedAccounting)

const hasUpgrade = (previous: SubscriptionEntitlementSnapshot, current: SubscriptionEntitlementSnapshot) =>
  current.maxTeamMembers > previous.maxTeamMembers
  || current.maxProperties > previous.maxProperties
  || current.maxLeads > previous.maxLeads
  || current.maxStorageMb > previous.maxStorageMb
  || (!previous.hasCustomDomain && current.hasCustomDomain)
  || (!previous.hasAdvancedAnalytics && current.hasAdvancedAnalytics)
  || (!previous.hasWhatsAppIntegration && current.hasWhatsAppIntegration)
  || (!previous.hasSmsAutomation && current.hasSmsAutomation)
  || (!previous.hasPremiumTemplates && current.hasPremiumTemplates)
  || (!previous.hasLeadAutomations && current.hasLeadAutomations)
  || (!previous.hasAdvancedAccounting && current.hasAdvancedAccounting)

/**
 * Canonical orchestration point for every effective subscription entitlement change.
 *
 * All mutations run in the caller's plan-change transaction. Destructive business
 * data is never deleted on downgrade: access/execution is restricted and the
 * original records/configuration remain available for a later upgrade or manual
 * quota swap.
 */
export const reconcileOrganizationEntitlements = async (
  organizationId: string,
  previousPlan: SubscriptionEntitlementInput | null | undefined,
  newPlan: SubscriptionEntitlementInput,
  options: { session?: ClientSession; actorId?: string; reason?: string } = {},
): Promise<SubscriptionEntitlementReconciliationResult> => {
  let current = await resolveSubscriptionEntitlementSnapshot(newPlan, options.session)
  let previous = await resolveSubscriptionEntitlementSnapshot(previousPlan, options.session, current)
  const tenantOverride = await getActiveTenantEntitlementOverride(organizationId, options.session)
  const applyOverride = (snapshot: SubscriptionEntitlementSnapshot): SubscriptionEntitlementSnapshot => {
    const applied = applyTenantEntitlementOverride({
      maxLeads: snapshot.maxLeads, maxProperties: snapshot.maxProperties, maxTeamMembers: snapshot.maxTeamMembers,
      maxStorageMb: snapshot.maxStorageMb, maxMonthlyVisitors: 0, hasCustomDomain: snapshot.hasCustomDomain,
      hasAdvancedAnalytics: snapshot.hasAdvancedAnalytics, hasWhatsAppIntegration: snapshot.hasWhatsAppIntegration,
      hasSmsAutomation: snapshot.hasSmsAutomation, hasLeadAutomations: snapshot.hasLeadAutomations,
      hasPremiumTemplates: snapshot.hasPremiumTemplates, hasAdvancedAccounting: Boolean(snapshot.hasAdvancedAccounting),
    }, tenantOverride)
    return { ...snapshot, maxLeads: applied.maxLeads, maxProperties: applied.maxProperties, maxTeamMembers: applied.maxTeamMembers, maxStorageMb: applied.maxStorageMb, hasCustomDomain: applied.hasCustomDomain, hasAdvancedAnalytics: applied.hasAdvancedAnalytics, hasWhatsAppIntegration: applied.hasWhatsAppIntegration, hasSmsAutomation: applied.hasSmsAutomation, hasLeadAutomations: applied.hasLeadAutomations, hasPremiumTemplates: applied.hasPremiumTemplates, hasAdvancedAccounting: applied.hasAdvancedAccounting }
  }
  if (!newPlan.tenantOverrideApplied) current = applyOverride(current)
  if (!previousPlan?.tenantOverrideApplied) previous = applyOverride(previous)
  const downgrade = hasDowngrade(previous, current)
  const upgrade = hasUpgrade(previous, current)
  const direction: SubscriptionEntitlementReconciliationResult['direction'] = downgrade ? 'downgrade' : upgrade ? 'upgrade' : 'unchanged'
  const reason = options.reason || `Subscription entitlements reconciled for ${current.plan} v${current.planVersion}`

  const teamSeats = await reconcileTeamSeats(organizationId, current.maxTeamMembers, {
    session: options.session,
    actorId: options.actorId,
    reason,
    previousMaxTeamMembers: previous.maxTeamMembers,
  })

  const resources = await reconcileResourceEntitlements(organizationId, previous, current, {
    session: options.session,
    actorId: options.actorId,
    reason,
  })

  return { organizationId, direction, previous, current, teamSeats, resources }
}

/** Publish cache/realtime side effects only after the plan-change transaction commits. */
export const publishSubscriptionEntitlementReconciliation = async (
  result?: SubscriptionEntitlementReconciliationResult | null,
): Promise<void> => {
  if (!result) return
  await Promise.all([
    publishTeamSeatReconciliation(result.teamSeats),
    publishResourceEntitlementReconciliation(result.resources),
  ])
}
