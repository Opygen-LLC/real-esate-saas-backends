import { describe, expect, it } from 'vitest'
import {
  buildEntitlementsFromLegacy,
  normalizeEntitlementWrite,
  resolveEntitlementSource,
} from '../../app/module/entitlement/featureCatalog'
import { PlatformSettingsValidation } from '../../app/module/platformSettings/platformSettings.validation'

const legacy = {
  maxAgents: 2,
  maxProperties: 5,
  maxLeads: 50,
  maxStorageMb: 512,
  maxMonthlyVisitors: 5000,
  hasPremiumTemplates: false,
  hasCustomDomain: false,
  hasAdvancedAnalytics: false,
  hasWhatsAppIntegration: false,
  hasSmsAutomation: false,
  hasLeadAutomations: false,
}

describe('unified entitlement catalog', () => {
  it('builds the canonical entitlement map from grandfathered legacy fields', () => {
    const entitlements = buildEntitlementsFromLegacy(legacy)
    expect(entitlements.leads).toEqual({ enabled: true, limit: 50 })
    expect(entitlements.properties).toEqual({ enabled: true, limit: 5 })
    expect(entitlements.teamMembers).toEqual({ enabled: true, limit: 2 })
    expect(entitlements.storage).toEqual({ enabled: true, limit: 512 })
    expect(entitlements.customDomain).toEqual({ enabled: false })
  })

  it('treats persisted entitlements as authoritative while mirroring legacy fields', () => {
    const resolved = resolveEntitlementSource({
      ...legacy,
      entitlements: {
        leads: { enabled: true, limit: 75 },
        customDomain: { enabled: true },
      },
    })
    expect(resolved.maxLeads).toBe(75)
    expect(resolved.hasCustomDomain).toBe(true)
    expect(resolved.entitlements.leads?.limit).toBe(75)
  })

  it('keeps old dashboard writes compatible by rebuilding entitlements from legacy values', () => {
    const normalized = normalizeEntitlementWrite({ ...legacy, maxLeads: 100 })
    expect(normalized.maxLeads).toBe(100)
    expect(normalized.entitlements.leads).toEqual({ enabled: true, limit: 100 })
  })

  it('normalizes the Super Admin trial payload into canonical and legacy fields', () => {
    const result = PlatformSettingsValidation.update.parse({ body: {
      reason: 'Adjust trial limits for launch testing',
      trial: {
        enabled: true,
        defaultTrialDays: 14,
        gracePeriodDays: 3,
        reminderDaysBeforeExpiry: 3,
        maxTeamMembers: 2,
        maxProperties: 5,
        maxLeads: 50,
        maxStorageMb: 512,
        maxMonthlyVisitors: 5000,
        hasPremiumTemplates: false,
        hasCustomDomain: false,
        hasAdvancedAnalytics: false,
        hasWhatsAppIntegration: false,
        hasSmsAutomation: false,
        hasLeadAutomations: false,
      },
    } })

    expect(result.body.trial?.maxAgents).toBe(2)
    expect(result.body.trial?.entitlements.leads).toEqual({ enabled: true, limit: 50 })
    expect(result.body.trial?.entitlements.properties).toEqual({ enabled: true, limit: 5 })
  })
})
