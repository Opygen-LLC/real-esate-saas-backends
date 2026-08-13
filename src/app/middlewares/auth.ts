import { NextFunction, Request, Response } from 'express'
import { Secret } from 'jsonwebtoken'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { jwtHelpers } from '../helpers/jwtHelpers'
import { Organization } from '../module/organization/organization.model'
import { ImpersonationSession } from '../module/platformAdmin/impersonationSession.model'
import { User } from '../module/user/user.model'
import { RequestContext } from '../../shared/requestContext'

export type Permission = 'properties.read' | 'properties.write' | 'properties.delete' | 'leads.read' | 'leads.write' |
  'leads.assign' | 'users.read' | 'users.write' | 'billing.manage' | 'website.write' | 'domains.manage' | 'analytics.advanced' |
  'compliance.read' | 'compliance.write' | 'crm.configure' | 'crm.export' | 'messaging.manage' | 'whatsapp.manage'
export const permissionMatrix: Record<string, Permission[]> = {
  agency_owner: ['properties.read', 'properties.write', 'properties.delete', 'leads.read', 'leads.write', 'leads.assign', 'users.read', 'users.write', 'billing.manage', 'website.write', 'domains.manage', 'analytics.advanced', 'compliance.read', 'compliance.write', 'crm.configure', 'crm.export', 'messaging.manage', 'whatsapp.manage'],
  agency_admin: ['properties.read', 'properties.write', 'properties.delete', 'leads.read', 'leads.write', 'leads.assign', 'users.read', 'users.write', 'website.write', 'analytics.advanced', 'compliance.read', 'crm.configure', 'crm.export', 'messaging.manage', 'whatsapp.manage'],
  agent: ['properties.read', 'properties.write', 'leads.read', 'leads.write'],
  viewer: ['properties.read', 'leads.read'], user: ['properties.read'], 'super-admin': [],
}

export const permissionsForRole = (role: string): Permission[] => [...(permissionMatrix[role] || [])]
export const roleHasPermission = (role: string, permission: Permission): boolean => permissionMatrix[role]?.includes(permission) || false

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const tryImpersonation = async (req: Request): Promise<boolean> => {
  const token = req.cookies?.[config.security.impersonation_cookie_name]
  if (typeof token !== 'string' || !token) return false
  try {
    const payload: any = jwtHelpers.verifyToken(token, config.jwt.secret as Secret)
    if (payload.typ !== 'support_impersonation' || !payload.impersonationSessionId || !payload.supportAdminId || !payload._id || !payload.organizationId) return false
    const session: any = await ImpersonationSession.findOne({ _id: payload.impersonationSessionId, endedAt: null, expiresAt: { $gt: new Date() } }).lean()
    if (!session || session.adminUserId.toString() !== String(payload.supportAdminId) || session.targetUserId.toString() !== String(payload._id) || session.organizationId !== String(payload.organizationId)) return false
    const [target, supportAdmin] = await Promise.all([
      User.findOne({ _id: payload._id, organizationId: payload.organizationId, status: 'active', isVerified: true }).select('_id email phoneNumber userRole organizationId').lean(),
      User.exists({ _id: session.adminUserId, userRole: 'super-admin', status: 'active', isVerified: true }),
    ])
    if (!supportAdmin) throw new ApiError(401, 'Support administrator is no longer authorized')
    if (!target) throw new ApiError(401, 'Impersonated tenant user is unavailable')
    if (!SAFE_METHODS.has(req.method.toUpperCase())) throw new ApiError(403, 'Support impersonation is read-only. End impersonation before making changes.')
    req.user = { _id: target._id.toString(), email: target.email, phoneNumber: target.phoneNumber, userRole: target.userRole, organizationId: target.organizationId }
    req.tenant = { organizationId: target.organizationId, userId: target._id.toString(), role: target.userRole, permissions: permissionMatrix[target.userRole] || [] }
    RequestContext.setTenant(target.organizationId, target._id.toString())
    req.impersonation = { sessionId: session._id.toString(), adminUserId: session.adminUserId.toString(), organizationId: session.organizationId, readOnly: true, expiresAt: session.expiresAt }
    return true
  } catch (error) {
    if (error instanceof ApiError) throw error
    return false
  }
}

const authenticate = async (req: Request): Promise<void> => {
  if (await tryImpersonation(req)) return
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.cookies?.[config.security.access_cookie_name]
  if (!token) throw new ApiError(401, 'Authentication required')
  let payload: any
  try { payload = jwtHelpers.verifyToken(token, config.jwt.secret as Secret) } catch { throw new ApiError(401, 'Invalid or expired access token') }
  const user: any = await User.findById(payload._id).select('_id email phoneNumber userRole organizationId status isVerified').lean()
  if (!user || user.status !== 'active' || !user.isVerified) throw new ApiError(401, 'Account is unavailable')
  if (payload.organizationId !== user.organizationId) throw new ApiError(401, 'Token tenant mismatch')
  if (user.userRole !== 'super-admin') {
    const organizationAvailable = await Organization.exists({ organizationId: user.organizationId, isBlocked: { $ne: true } })
    if (!organizationAvailable) throw new ApiError(403, 'Organization access is suspended')
  }
  req.user = { _id: user._id.toString(), email: user.email, phoneNumber: user.phoneNumber, userRole: user.userRole, organizationId: user.organizationId }
  if (user.userRole !== 'super-admin') {
    req.tenant = { organizationId: user.organizationId, userId: user._id.toString(), role: user.userRole, permissions: permissionMatrix[user.userRole] || [] }
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
export const authMiddlewares = { auth, authSuperAdmin, requirePermission }
