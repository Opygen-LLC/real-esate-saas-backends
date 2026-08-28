import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import type { SubscriptionStatus } from '../organization/organization.interface'
import {
  ACCESSIBLE_SUBSCRIPTION_STATUSES,
  type EffectiveTenantAccess,
  type TenantAccessOrganizationShape,
  type TenantAccessReason,
  type TenantPlatformAccessStatus,
  type TenantWebsiteStatus,
} from './tenantAccess.types'

const ACCESSIBLE_SUBSCRIPTION_STATUS_SET = new Set<string>(ACCESSIBLE_SUBSCRIPTION_STATUSES)
const PLATFORM_STATUSES = new Set<TenantPlatformAccessStatus>(['active', 'suspended', 'archived', 'pending_deletion'])
const WEBSITE_STATUSES = new Set<TenantWebsiteStatus>(['provisioned', 'published', 'suspended'])

const asDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export const tenantPlatformStatusOf = (organization: TenantAccessOrganizationShape): TenantPlatformAccessStatus => {
  const raw = String(organization.platformAccess?.status || '').trim() as TenantPlatformAccessStatus
  if (Boolean(organization.isBlocked) && (!raw || raw === 'active')) return 'suspended'
  return PLATFORM_STATUSES.has(raw) ? raw : 'active'
}

export const tenantWebsiteStatusOf = (organization: TenantAccessOrganizationShape): TenantWebsiteStatus => {
  const raw = String(organization.websiteStatus || '').trim() as TenantWebsiteStatus
  return WEBSITE_STATUSES.has(raw) ? raw : 'published'
}

export const tenantSubscriptionStatusOf = (organization: TenantAccessOrganizationShape): SubscriptionStatus => {
  const raw = String(organization.subscription?.status || 'expired')
  if (['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended'].includes(raw)) {
    return raw as SubscriptionStatus
  }
  return 'expired'
}

const accessReason = (input: {
  platformStatus: TenantPlatformAccessStatus
  websiteStatus: TenantWebsiteStatus
  subscriptionStatus: SubscriptionStatus
  plan: string
}): TenantAccessReason => {
  if (input.platformStatus === 'pending_deletion') return 'TENANT_PENDING_DELETION'
  if (input.platformStatus === 'archived') return 'PLATFORM_ARCHIVED'
  if (input.platformStatus === 'suspended') return 'PLATFORM_SUSPENDED'

  if (!ACCESSIBLE_SUBSCRIPTION_STATUS_SET.has(input.subscriptionStatus)) {
    if (input.plan === 'trial' && input.subscriptionStatus === 'grace') return 'TRIAL_ENDED'
    if (input.plan === 'trial' && input.subscriptionStatus === 'expired') return 'TRIAL_EXPIRED'
    if (input.subscriptionStatus === 'past_due') return 'PAYMENT_PAST_DUE'
    if (input.subscriptionStatus === 'grace') return 'SUBSCRIPTION_GRACE'
    return 'SUBSCRIPTION_EXPIRED'
  }

  if (input.websiteStatus !== 'published') return 'WEBSITE_NOT_PUBLISHED'
  return 'ACTIVE'
}

export const evaluateTenantAccessOrganization = (
  organization: TenantAccessOrganizationShape,
  now = new Date(),
): EffectiveTenantAccess => {
  const organizationId = String(organization.organizationId || '').trim()
  if (!organizationId) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Organization access state is invalid', '', 'TENANT_ACCESS_STATE_INVALID')
  }

  const plan = String(organization.subscription?.plan || 'trial').trim().toLowerCase() || 'trial'
  const parsedPlanVersion = Number(organization.subscription?.planVersion || 1)
  const planVersion = Number.isFinite(parsedPlanVersion) ? Math.max(1, Math.floor(parsedPlanVersion)) : 1
  const subscriptionStatus = tenantSubscriptionStatusOf(organization)
  const platformStatus = tenantPlatformStatusOf(organization)
  const websiteStatus = tenantWebsiteStatusOf(organization)
  const platformAllowed = platformStatus === 'active'
  const subscriptionAllowed = ACCESSIBLE_SUBSCRIPTION_STATUS_SET.has(subscriptionStatus)
  const workspaceAllowed = platformAllowed && subscriptionAllowed
  const publicWebsiteAllowed = workspaceAllowed && websiteStatus === 'published'
  const reason = accessReason({ platformStatus, websiteStatus, subscriptionStatus, plan })

  return {
    organizationId,
    workspaceAllowed,
    publicWebsiteAllowed,
    publicWritesAllowed: publicWebsiteAllowed,
    backgroundBusinessWorkAllowed: workspaceAllowed,
    reason,
    recoveryAllowed: platformAllowed && !subscriptionAllowed,
    plan,
    planVersion,
    subscriptionStatus,
    currentPeriodEnd: asDate(organization.subscription?.currentPeriodEnd),
    gracePeriodEnd: asDate(organization.subscription?.gracePeriodEnd),
    platformStatus,
    websiteStatus,
    evaluatedAt: now,
  }
}

export const isTenantSubscriptionAccessible = (status?: string | null): boolean =>
  Boolean(status && ACCESSIBLE_SUBSCRIPTION_STATUS_SET.has(String(status)))
