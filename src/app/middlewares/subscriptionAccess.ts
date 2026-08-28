import { Request } from 'express'
import ApiError from '../../errors/ApiError'
import { TenantAccessService } from '../module/tenantAccess/tenantAccess.service'
import type { EffectiveTenantAccess, TenantAccessReason } from '../module/tenantAccess/tenantAccess.types'

const requestAccess = new WeakMap<Request, Promise<EffectiveTenantAccess>>()

const apiPath = (req: Request): string => {
  const raw = String(req.originalUrl || req.url || req.path || '').split('?')[0]
  return raw.replace(/^\/api\/v1(?=\/|$)/, '') || '/'
}

/**
 * Recovery routes stay reachable after subscription expiry so the agency can
 * authenticate, inspect billing, renew, manage its own profile, or contact
 * support. Platform suspension/archive/deletion still wins before this bypass.
 */
export const isSubscriptionRecoveryRequest = (req: Request): boolean => {
  const path = apiPath(req)
  const method = String(req.method || 'GET').toUpperCase()

  if (path === '/auth/session' || path === '/auth/realtime-ticket' || path === '/auth/change-password') return true
  if (path.startsWith('/auth/sessions')) return true
  if (path === '/users/me/profile' || path === '/users/me/access') return true
  if (path === '/organization' && method === 'GET') return true
  if (path.startsWith('/billing')) return true
  if (path === '/subscription' || path.startsWith('/subscription/')) return true
  if (path === '/website-price' || path.startsWith('/website-price/')) return true
  if (path.startsWith('/support')) return true
  if (path.startsWith('/bkash') || path.startsWith('/bkash-payment')) return true
  return false
}

const accessForRequest = (req: Request): Promise<EffectiveTenantAccess> => {
  const existing = requestAccess.get(req)
  if (existing) return existing
  const organizationId = req.tenant?.organizationId
  if (!organizationId) return Promise.reject(new ApiError(403, 'Tenant context required'))

  const pending = TenantAccessService.evaluate(organizationId, {
    reconcileSubscription: true,
    actorId: 'system:subscription-access',
  })
  requestAccess.set(req, pending)
  return pending
}

const platformAccessError = (access: EffectiveTenantAccess): ApiError | null => {
  if (access.reason === 'TENANT_PENDING_DELETION') return new ApiError(403, 'Your agency is pending permanent deletion', '', 'TENANT_PENDING_DELETION')
  if (access.reason === 'PLATFORM_ARCHIVED') return new ApiError(403, 'Your agency has been archived', '', 'TENANT_ARCHIVED')
  if (access.reason === 'PLATFORM_SUSPENDED') return new ApiError(403, 'Your agency has been suspended', '', 'TENANT_SUSPENDED')
  return null
}

const subscriptionMessage = (reason: TenantAccessReason, status: string): string => {
  if (reason === 'TRIAL_ENDED') return 'Your free trial has ended. Choose a subscription plan to regain access to your workspace.'
  if (reason === 'TRIAL_EXPIRED') return 'Your free trial has expired. Choose a subscription plan to regain access to your workspace.'
  if (reason === 'PAYMENT_PAST_DUE') return 'Your subscription payment is past due. Renew your subscription to regain access to your workspace.'
  if (reason === 'SUBSCRIPTION_GRACE') return 'Your subscription renewal is overdue. Renew your subscription to regain access to your workspace.'
  return `Subscription is ${status}. Renew or choose an active plan to continue.`
}

export const enforceSubscriptionAccess = async (req: Request): Promise<EffectiveTenantAccess | null> => {
  if (!req.user || req.user.userRole === 'super-admin' || !req.tenant?.organizationId) return null

  const access = await accessForRequest(req)
  const platformError = platformAccessError(access)
  if (platformError) throw platformError

  if (isSubscriptionRecoveryRequest(req)) return access
  if (access.workspaceAllowed) return access

  throw new ApiError(
    402,
    subscriptionMessage(access.reason, access.subscriptionStatus),
    '',
    'SUBSCRIPTION_INACTIVE',
    {
      reason: access.reason,
      currentPlan: access.plan,
      currentPlanVersion: access.planVersion,
      subscriptionStatus: access.subscriptionStatus,
      currentPeriodEnd: access.currentPeriodEnd?.toISOString() || null,
      gracePeriodEnd: access.gracePeriodEnd?.toISOString() || null,
      workspaceAllowed: access.workspaceAllowed,
      publicWebsiteAllowed: access.publicWebsiteAllowed,
      publicWritesAllowed: access.publicWritesAllowed,
      backgroundBusinessWorkAllowed: access.backgroundBusinessWorkAllowed,
      recoveryAllowed: access.recoveryAllowed,
      effectiveAccess: access,
      upgradeRequired: true,
    },
  )
}

export const subscriptionAccess = async (req: Request, _res: unknown, next: (error?: unknown) => void): Promise<void> => {
  try {
    await enforceSubscriptionAccess(req)
    next()
  } catch (error) {
    next(error)
  }
}
