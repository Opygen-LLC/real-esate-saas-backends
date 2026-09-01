import type { ClientSession } from 'mongoose'
import { TenantEntitlementOverride } from './tenantEntitlementOverride.model'
import type { ITenantEntitlementOverride, TenantNumericEntitlementOverride } from './tenantEntitlementOverride.interface'

export type EffectiveTenantLimits = {
  maxLeads: number
  maxProperties: number
  maxTeamMembers: number
  maxStorageMb: number
  maxMonthlyVisitors: number
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasSmsAutomation: boolean
  hasLeadAutomations: boolean
  hasPremiumTemplates: boolean
  hasAdvancedAccounting: boolean
}

const numeric = (base: number, input?: TenantNumericEntitlementOverride) => {
  if (!input) return Math.max(0, Number(base || 0))
  const value = Math.max(0, Number(input.value || 0))
  return input.mode === 'set' ? value : Math.max(0, Number(base || 0)) + value
}

export const getActiveTenantEntitlementOverride = async (organizationId: string, session?: ClientSession, now = new Date()) => {
  const query = TenantEntitlementOverride.findOne({
    organizationId,
    status: 'active',
    startsAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).sort({ version: -1, _id: -1 })
  if (session) query.session(session)
  return query.lean() as Promise<ITenantEntitlementOverride | null>
}

export const applyTenantEntitlementOverride = (base: EffectiveTenantLimits, override?: ITenantEntitlementOverride | null): EffectiveTenantLimits => {
  if (!override) return base
  const resources = override.resources || {}
  const features = override.features || {}
  return {
    maxLeads: numeric(base.maxLeads, resources.leads),
    maxProperties: numeric(base.maxProperties, resources.properties),
    maxTeamMembers: numeric(base.maxTeamMembers, resources.teamMembers),
    maxStorageMb: numeric(base.maxStorageMb, resources.storageMb),
    maxMonthlyVisitors: numeric(base.maxMonthlyVisitors, resources.monthlyVisitors),
    hasCustomDomain: features.customDomain ?? base.hasCustomDomain,
    hasAdvancedAnalytics: features.advancedAnalytics ?? base.hasAdvancedAnalytics,
    hasWhatsAppIntegration: features.whatsappIntegration ?? base.hasWhatsAppIntegration,
    hasSmsAutomation: features.smsAutomation ?? base.hasSmsAutomation,
    hasLeadAutomations: features.leadAutomations ?? base.hasLeadAutomations,
    hasPremiumTemplates: features.premiumTemplates ?? base.hasPremiumTemplates,
    hasAdvancedAccounting: features.advancedAccounting ?? base.hasAdvancedAccounting,
  }
}
