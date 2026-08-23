import { Request } from 'express'
import ApiError from '../../errors/ApiError'
import { reconcileOrganizationSubscriptionBoundary, type SubscriptionBoundarySnapshot } from '../module/subscription/subscriptionLifecycle.service'

const ACCESSIBLE_STATUSES = new Set(['trialing', 'active', 'cancel_at_period_end'])
const requestSnapshots = new WeakMap<Request, Promise<SubscriptionBoundarySnapshot>>()

const apiPath = (req: Request): string => {
  const raw = String(req.originalUrl || req.url || req.path || '').split('?')[0]
  return raw.replace(/^\/api\/v1(?=\/|$)/, '') || '/'
}

/**
 * Recovery routes stay reachable after expiry so the agency can authenticate,
 * inspect its subscription, pay/renew, manage its own profile, or contact
 * support. The lifecycle boundary is still reconciled before these requests;
 * only the blocking decision is bypassed.
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

const subscriptionSnapshotForRequest = (req: Request): Promise<SubscriptionBoundarySnapshot> => {
  const existing = requestSnapshots.get(req)
  if (existing) return existing
  const organizationId = req.tenant?.organizationId
  if (!organizationId) {
    return Promise.reject(new ApiError(403, 'Tenant context required'))
  }
  const pending = reconcileOrganizationSubscriptionBoundary(organizationId)
  requestSnapshots.set(req, pending)
  return pending
}

export const enforceSubscriptionAccess = async (req: Request): Promise<SubscriptionBoundarySnapshot | null> => {
  if (!req.user || req.user.userRole === 'super-admin' || !req.tenant?.organizationId) return null

  const subscription = await subscriptionSnapshotForRequest(req)
  if (isSubscriptionRecoveryRequest(req)) return subscription
  if (ACCESSIBLE_STATUSES.has(subscription.status)) return subscription

  throw new ApiError(
    402,
    subscription.status === 'grace'
      ? 'Your subscription renewal is overdue. Renew your subscription to regain access to your workspace.'
      : `Subscription is ${subscription.status}. Renew or choose an active plan to continue.`,
    '',
    'SUBSCRIPTION_INACTIVE',
    {
      currentPlan: subscription.plan,
      currentPlanVersion: subscription.planVersion,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      gracePeriodEnd: subscription.gracePeriodEnd?.toISOString() || null,
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
