export type TenantEntitlementOverrideMode = 'add' | 'set'
export type TenantEntitlementOverrideStatus = 'active' | 'revoked' | 'expired'

export interface TenantNumericEntitlementOverride {
  mode: TenantEntitlementOverrideMode
  value: number
}

export interface ITenantEntitlementOverride {
  organizationId: string
  version: number
  activeKey?: string
  status: TenantEntitlementOverrideStatus
  resources?: {
    leads?: TenantNumericEntitlementOverride
    properties?: TenantNumericEntitlementOverride
    teamMembers?: TenantNumericEntitlementOverride
    storageMb?: TenantNumericEntitlementOverride
    monthlyVisitors?: TenantNumericEntitlementOverride
  }
  features?: {
    customDomain?: boolean
    advancedAnalytics?: boolean
    whatsappIntegration?: boolean
    smsAutomation?: boolean
    leadAutomations?: boolean
    premiumTemplates?: boolean
  }
  startsAt: Date
  expiresAt?: Date | null
  reason: string
  createdBy: string
  revokedAt?: Date | null
  revokedBy?: string
  revokeReason?: string
  createdAt?: Date
  updatedAt?: Date
}
