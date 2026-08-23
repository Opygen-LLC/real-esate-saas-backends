import { NextFunction, Request, Response } from 'express'
import { Secret } from 'jsonwebtoken'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { jwtHelpers } from '../helpers/jwtHelpers'
import { Organization } from '../module/organization/organization.model'
import { asUserObjectId, findUserWithProfiles } from '../module/user/userReadModel.service'
import { RequestContext } from '../../shared/requestContext'

import { effectivePermissionsForUser, Permission, permissionMatrix, permissionsForRole, roleHasPermission } from '../module/user/accessControl'
import { toAuthUserDto } from '../module/user/userProfile.service'
import { enforceSubscriptionAccess } from './subscriptionAccess'

const authenticate = async (req: Request): Promise<void> => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.cookies?.[config.security.access_cookie_name]
  if (!token) throw new ApiError(401, 'Authentication required')
  let payload: any
  try { payload = jwtHelpers.verifyToken(token, config.jwt.secret as Secret) } catch { throw new ApiError(401, 'Invalid or expired access token') }
  const userId = asUserObjectId(String(payload._id))
  const user: any = userId ? await findUserWithProfiles({ _id: userId }) : null
  if (!user) throw new ApiError(401, 'Account is unavailable')
  if (user.status === 'blocked') throw new ApiError(403, 'Your account has been suspended', '', 'USER_SUSPENDED')
  if (user.status !== 'active' || !user.isVerified) throw new ApiError(401, 'Account is unavailable')
  if (payload.organizationId !== user.organizationId) throw new ApiError(401, 'Token tenant mismatch')
  if (user.userRole !== 'super-admin') {
    const organizationAvailable = await Organization.exists({ organizationId: user.organizationId, isBlocked: { $ne: true } })
    if (!organizationAvailable) throw new ApiError(403, 'Your agency has been suspended', '', 'TENANT_SUSPENDED')
  }
  const authUser: any = toAuthUserDto(user)
  const accessControl = user.profile?.accessControl || { useRoleDefaults: true, permissions: [] }
  req.user = { ...authUser, _id: user._id.toString() }
  if (user.userRole !== 'super-admin') {
    req.tenant = { organizationId: user.organizationId, userId: user._id.toString(), role: user.userRole, permissions: effectivePermissionsForUser({ userRole: user.userRole, accessControl }) }
    RequestContext.setTenant(user.organizationId, user._id.toString())
  } else RequestContext.setTenant(undefined, user._id.toString())
}
const auth = (...roles: string[]) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await authenticate(req)
    if (roles.length && !roles.includes(req.user!.userRole!)) throw new ApiError(403, 'Forbidden')
    await enforceSubscriptionAccess(req)
    next()
  } catch (error) { next(error) }
}
const requirePermission = (permission: Permission) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) await authenticate(req)
    if (!req.tenant?.permissions.includes(permission)) throw new ApiError(403, `Missing permission: ${permission}`)
    await enforceSubscriptionAccess(req)
    next()
  } catch (error) { next(error) }
}
const requireAnyPermission = (...permissions: Permission[]) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) await authenticate(req)
    if (!permissions.some((permission) => req.tenant?.permissions.includes(permission))) throw new ApiError(403, `Missing one of permissions: ${permissions.join(', ')}`)
    await enforceSubscriptionAccess(req)
    next()
  } catch (error) { next(error) }
}
const authSuperAdmin = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try { await authenticate(req); if (req.user!.userRole !== 'super-admin') throw new ApiError(403, 'Platform administrator access required'); next() }
  catch (error) { next(error) }
}
export const requireTenant = (req: Request): string => {
  if (!req.tenant?.organizationId) throw new ApiError(403, 'Tenant context required')
  return req.tenant.organizationId
}
export { Permission, permissionMatrix, permissionsForRole, roleHasPermission }
export const authMiddlewares = { auth, authSuperAdmin, requirePermission, requireAnyPermission }
