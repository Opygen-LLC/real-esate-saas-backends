import type { SubscriptionStatus } from '../organization/organization.interface'

export const ACCESSIBLE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'cancel_at_period_end'] as const

export type TenantPlatformAccessStatus = 'active' | 'suspended' | 'archived' | 'pending_deletion'
export type TenantWebsiteStatus = 'provisioned' | 'published' | 'suspended'

export type TenantAccessReason =
  | 'ACTIVE'
  | 'PLATFORM_SUSPENDED'
  | 'PLATFORM_ARCHIVED'
  | 'TENANT_PENDING_DELETION'
  | 'TRIAL_ENDED'
  | 'TRIAL_EXPIRED'
  | 'PAYMENT_PAST_DUE'
  | 'SUBSCRIPTION_GRACE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'WEBSITE_NOT_PUBLISHED'

export type EffectiveTenantAccess = {
  organizationId: string
  workspaceAllowed: boolean
  publicWebsiteAllowed: boolean
  publicWritesAllowed: boolean
  backgroundBusinessWorkAllowed: boolean
  reason: TenantAccessReason
  recoveryAllowed: boolean
  plan: string
  planVersion: number
  subscriptionStatus: SubscriptionStatus
  currentPeriodEnd: Date | null
  gracePeriodEnd: Date | null
  platformStatus: TenantPlatformAccessStatus
  websiteStatus: TenantWebsiteStatus
  evaluatedAt: Date
}

export type TenantAccessOrganizationShape = {
  organizationId?: unknown
  isBlocked?: unknown
  platformAccess?: { status?: unknown } | null
  websiteStatus?: unknown
  subscription?: {
    plan?: unknown
    planVersion?: unknown
    status?: unknown
    currentPeriodEnd?: unknown
    gracePeriodEnd?: unknown
  } | null
}

export type TenantAccessEvaluationOptions = {
  reconcileSubscription?: boolean
  now?: Date
  actorId?: string
}
