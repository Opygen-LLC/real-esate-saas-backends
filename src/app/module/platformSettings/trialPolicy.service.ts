import { Cache } from '../../../shared/cache'
import { buildEntitlementsFromLegacy, resolveEntitlementSource } from '../entitlement/featureCatalog'
import type { EntitlementConfig } from '../entitlement/entitlement.types'
import { PlatformSettings } from './platformSettings.model'

export interface TrialPolicy {
  enabled: boolean
  defaultTrialDays: number
  gracePeriodDays: number
  reminderDaysBeforeExpiry: number
  entitlements: EntitlementConfig
  maxAgents: number
  maxProperties: number
  maxLeads: number
  maxStorageMb: number
  maxMonthlyVisitors: number
  hasPremiumTemplates: boolean
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasSmsAutomation: boolean
  hasLeadAutomations: boolean
}

const DEFAULT_TRIAL_LEGACY = {
  maxAgents: 2,
  maxProperties: 10,
  maxLeads: 100,
  maxStorageMb: 512,
  maxMonthlyVisitors: 5000,
  hasPremiumTemplates: false,
  hasCustomDomain: false,
  hasAdvancedAnalytics: false,
  hasWhatsAppIntegration: false,
  hasSmsAutomation: false,
  hasLeadAutomations: false,
}

export const DEFAULT_TRIAL_POLICY: TrialPolicy = {
  enabled: true,
  defaultTrialDays: 14,
  gracePeriodDays: 3,
  reminderDaysBeforeExpiry: 3,
  ...DEFAULT_TRIAL_LEGACY,
  entitlements: buildEntitlementsFromLegacy(DEFAULT_TRIAL_LEGACY),
}

export const getTrialPolicy = async (): Promise<TrialPolicy> => {
  const cached = await Cache.platformSettings.get<TrialPolicy>('trial-policy')
  if (cached) return resolveEntitlementSource(cached as TrialPolicy) as TrialPolicy

  const settings: any = await PlatformSettings.findOneAndUpdate(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform' } },
    { upsert: true, new: true },
  ).lean()

  const merged = { ...DEFAULT_TRIAL_POLICY, ...(settings?.trial || {}) }
  const policy = resolveEntitlementSource(merged) as TrialPolicy

  // Safe compatibility backfill: this only mirrors already-effective limits into
  // the canonical entitlement map and never changes a tenant subscription/version.
  if (!settings?.trial?.entitlements) {
    await PlatformSettings.updateOne(
      { key: 'platform' },
      { $set: { 'trial.entitlements': policy.entitlements } },
    )
  }

  await Cache.platformSettings.set('trial-policy', policy, 300)
  return policy
}

export const invalidateTrialPolicy = () => Cache.platformSettings.del('trial-policy')
export const trialEndFromPolicy = (policy: TrialPolicy, from = new Date()) => new Date(from.getTime() + Math.max(0, policy.defaultTrialDays) * 24 * 60 * 60 * 1000)
