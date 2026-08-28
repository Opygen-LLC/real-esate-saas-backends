import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { Organization } from '../organization/organization.model'
import { reconcileOrganizationSubscriptionBoundaryState } from '../subscription/subscriptionLifecycle.service'
import { evaluateTenantAccessOrganization, isTenantSubscriptionAccessible } from './tenantAccess.policy'
import {
  type EffectiveTenantAccess,
  type PublicTenantAccess,
  type TenantAccessEvaluationOptions,
  type TenantAccessOrganizationShape,
} from './tenantAccess.types'

const evaluateOrganization = (organization: TenantAccessOrganizationShape, now = new Date()): EffectiveTenantAccess =>
  evaluateTenantAccessOrganization(organization, now)

const evaluate = async (
  organizationId: string,
  options: TenantAccessEvaluationOptions = {},
): Promise<EffectiveTenantAccess> => {
  const normalizedOrganizationId = String(organizationId || '').trim()
  if (!normalizedOrganizationId) throw new ApiError(httpStatus.FORBIDDEN, 'Tenant context required')

  const now = options.now || new Date()
  if (options.reconcileSubscription === false) {
    const organization: any = await Organization.findOne({ organizationId: normalizedOrganizationId })
      .select('organizationId isBlocked platformAccess.status websiteStatus subscription')
      .lean()
    if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found', '', 'TENANT_NOT_FOUND')
    return evaluateOrganization(organization, now)
  }

  const reconciled = await reconcileOrganizationSubscriptionBoundaryState(
    normalizedOrganizationId,
    now,
    options.actorId || 'system:tenant-access',
  )
  return evaluateOrganization(reconciled.organization as TenantAccessOrganizationShape, now)
}

const toPublicAccess = (access: EffectiveTenantAccess): PublicTenantAccess => ({
  allowed: access.publicWebsiteAllowed,
  reason: access.reason,
})

const assertPublicWebsiteAccess = async (
  organizationId: string,
  options: TenantAccessEvaluationOptions = {},
): Promise<EffectiveTenantAccess> => {
  const access = await evaluate(organizationId, options)
  if (access.publicWebsiteAllowed) return access

  if (access.reason === 'WEBSITE_NOT_PUBLISHED') {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Agency website is not published',
      '',
      API_ERROR_CODES.PUBLIC_WEBSITE_NOT_PUBLISHED,
    )
  }

  if (access.reason === 'PLATFORM_SUSPENDED') {
    throw new ApiError(423, 'This agency website is currently unavailable', '', 'TENANT_SUSPENDED')
  }

  throw new ApiError(
    httpStatus.SERVICE_UNAVAILABLE,
    'Website temporarily unavailable',
    '',
    API_ERROR_CODES.PUBLIC_WEBSITE_UNAVAILABLE,
  )
}

export const TenantAccessService = {
  evaluate,
  evaluateOrganization,
  toPublicAccess,
  assertPublicWebsiteAccess,
  isSubscriptionAccessible: isTenantSubscriptionAccessible,
}
