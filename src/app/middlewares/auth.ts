import { NextFunction, Request, Response } from 'express'
import { Secret } from 'jsonwebtoken'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { jwtHelpers } from '../helpers/jwtHelpers'
import { Organization } from '../module/organization/organization.model'
import { ImpersonationSession } from '../module/platformAdmin/impersonationSession.model'
import { User } from '../module/user/user.model'
import { asUserObjectId, findUserWithProfiles } from '../module/user/userReadModel.service'
import { RequestContext } from '../../shared/requestContext'

import { effectivePermissionsForUser, Permission, permissionMatrix, permissionsForRole, roleHasPermission } from '../module/user/accessControl'
import { toAuthUserDto } from '../module/user/userProfile.service'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const tryImpersonation = async (req: Request): Promise<boolean> => {
  const token = req.cookies?.[config.security.impersonation_cookie_name]
  if (typeof token !== 'string' || !token) return false
  try {
    const payload: any = jwtHelpers.verifyToken(token, config.jwt.secret as Secret)
    if (payload.typ !== 'support_impersonation' || !payload.impersonationSessionId || !payload.supportAdminId || !payload._id || !payload.organizationId) return false
    const session: any = await ImpersonationSession.findOne({ _id: payload.impersonationSessionId, endedAt: null, expiresAt: { $gt: new Date() } }).lean()
    if (!session || session.adminUserId.toString() !== String(payload.supportAdminId) || session.targetUserId.toString() !== String(payload._id) || session.organizationId !== String(payload.organizationId)) return false
    const [target, supportAdmin, organizationAvailable] = await Promise.all([
      asUserObjectId(String(payload._id))
        ? findUserWithProfiles({ _id: asUserObjectId(String(payload._id)), organizationId: payload.organizationId, status: 'active', isVerified: true })
        : Promise.resolve(null),
      User.exists({ _id: session.adminUserId, userRole: 'super-admin', status: 'active', isVerified: true }),
      Organization.exists({ organizationId: payload.organizationId, isBlocked: { $ne: true }, 'platformAccess.status': { $ne: 'suspended' } }),
    ])
    if (!supportAdmin) throw new ApiError(401, 'Support administrator is no longer authorized')
    if (!organizationAvailable) throw new ApiError(401, 'Impersonated agency is no longer available')
    if (!target) throw new ApiError(401, 'Impersonated tenant user is unavailable')
    if (!SAFE_METHODS.has(req.method.toUpperCase())) throw new ApiError(403, 'Support impersonation is read-only. End impersonation before making changes.')
    const targetDto: any = toAuthUserDto(target)
    const accessControl = (target as any).profile?.accessControl || { useRoleDefaults: true, permissions: [] }
    req.user = { ...targetDto, _id: target._id.toString() }
    req.tenant = { organizationId: target.organizationId, userId: target._id.toString(), role: target.userRole, permissions: effectivePermissionsForUser({ userRole: target.userRole, accessControl }) }
    RequestContext.setTenant(target.organizationId, target._id.toString())
    req.impersonation = { sessionId: session._id.toString(), adminUserId: session.adminUserId.toString(), organizationId: session.organizationId, readOnly: true, expiresAt: session.expiresAt }
    return true
  } catch (error) {
    if (error instanceof ApiError) throw error
    return false
  }
}


const enforceImpersonationReadOnly = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const method = req.method.toUpperCase()
  if (SAFE_METHODS.has(method) || req.originalUrl.split('?')[0].endsWith('/platform-admin/impersonation/end')) return next()
  const token = req.cookies?.[config.security.impersonation_cookie_name]
  if (typeof token !== 'string' || !token) return next()
  try {
    const payload: any = jwtHelpers.verifyToken(token, config.jwt.secret as Secret)
    if (payload.typ !== 'support_impersonation' || !payload.impersonationSessionId || !payload.supportAdminId) return next()
    const active = await ImpersonationSession.exists({
      _id: payload.impersonationSessionId,
      adminUserId: payload.supportAdminId,
      targetUserId: payload._id,
      organizationId: payload.organizationId,
      endedAt: null,
      expiresAt: { $gt: new Date() },
    })
    if (active) return next(new ApiError(403, 'Support impersonation is read-only. Exit support mode before making changes.'))
    return next()
  } catch {
    // An expired/invalid support cookie must not lock a normal user out of writes.
    return next()
  }
}

const authenticate = async (req: Request): Promise<void> => {
  if (await tryImpersonation(req)) return
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
  try { await authenticate(req); if (roles.length && !roles.includes(req.user!.userRole!)) throw new ApiError(403, 'Forbidden'); next() }
  catch (error) { next(error) }
}
const requirePermission = (permission: Permission) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try { if (!req.user) await authenticate(req); if (req.tenant?.permissions.includes(permission)) return next()
    throw new ApiError(403, `Missing permission: ${permission}`) } catch (error) { next(error) }
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
export const authMiddlewares = { auth, authSuperAdmin, requirePermission, enforceImpersonationReadOnly }
