import { Cache } from '../../../shared/cache'
import { buildEntitlementsFromLegacy, resolveEntitlementSource } from '../entitlement/featureCatalog'
import type { EntitlementConfig } from '../entitlement/entitlement.types'
import { PlatformSettings } from './platformSettings.model'

export interface TrialPolicy {
  enabled: boolean
  defaultTrialDays: number
  gracePeriodDays: number
  trialGraceDays: number
  paidRenewalGraceDays: number
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
  trialGraceDays: 3,
  paidRenewalGraceDays: 0,
  reminderDaysBeforeExpiry: 3,
  ...DEFAULT_TRIAL_LEGACY,
  entitlements: buildEntitlementsFromLegacy(DEFAULT_TRIAL_LEGACY),
}

const normalizeTrialPolicy = (value: Partial<TrialPolicy> | Record<string, unknown>): TrialPolicy => {
  const persisted: any = value || {}
  const normalizedTrialGraceDays = Number(persisted.trialGraceDays ?? persisted.gracePeriodDays ?? DEFAULT_TRIAL_POLICY.trialGraceDays)
  return resolveEntitlementSource({
    ...DEFAULT_TRIAL_POLICY,
    ...persisted,
    gracePeriodDays: normalizedTrialGraceDays,
    trialGraceDays: normalizedTrialGraceDays,
    paidRenewalGraceDays: Number(persisted.paidRenewalGraceDays ?? DEFAULT_TRIAL_POLICY.paidRenewalGraceDays),
  }) as TrialPolicy
}

export const getTrialPolicy = async (): Promise<TrialPolicy> => {
  const cached = await Cache.platformSettings.get<TrialPolicy>('trial-policy')
  if (cached) return normalizeTrialPolicy(cached)

  const settings: any = await PlatformSettings.findOneAndUpdate(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform' } },
    { upsert: true, new: true },
  ).lean()

  const persisted = settings?.trial || {}
  const policy = normalizeTrialPolicy(persisted)

  // Safe compatibility backfill: this only mirrors already-effective limits into
  // the canonical entitlement map and never changes a tenant subscription/version.
  const compatibilityBackfill: Record<string, unknown> = {}
  if (!settings?.trial?.entitlements) compatibilityBackfill['trial.entitlements'] = policy.entitlements
  if (settings?.trial?.trialGraceDays === undefined) compatibilityBackfill['trial.trialGraceDays'] = policy.trialGraceDays
  if (settings?.trial?.paidRenewalGraceDays === undefined) compatibilityBackfill['trial.paidRenewalGraceDays'] = policy.paidRenewalGraceDays
  if (settings?.trial?.gracePeriodDays === undefined || Number(settings.trial.gracePeriodDays) !== policy.trialGraceDays) compatibilityBackfill['trial.gracePeriodDays'] = policy.trialGraceDays
  if (Object.keys(compatibilityBackfill).length) {
    await PlatformSettings.updateOne({ key: 'platform' }, { $set: compatibilityBackfill })
  }

  await Cache.platformSettings.set('trial-policy', policy, 300)
  return policy
}

export const invalidateTrialPolicy = () => Cache.platformSettings.del('trial-policy')
export const trialEndFromPolicy = (policy: TrialPolicy, from = new Date()) => new Date(from.getTime() + Math.max(0, policy.defaultTrialDays) * 24 * 60 * 60 * 1000)
