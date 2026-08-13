import { NextFunction, Request, Response } from 'express'
import { Secret } from 'jsonwebtoken'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { jwtHelpers } from '../helpers/jwtHelpers'
import { User } from '../module/user/user.model'

export type Permission = 'properties.read' | 'properties.write' | 'properties.delete' | 'leads.read' | 'leads.write' |
  'leads.assign' | 'users.read' | 'users.write' | 'billing.manage' | 'website.write' | 'domains.manage' | 'analytics.advanced' |
  'compliance.read' | 'compliance.write' | 'crm.configure' | 'crm.export' | 'messaging.manage' | 'whatsapp.manage'
const matrix: Record<string, Permission[]> = {
  agency_owner: ['properties.read', 'properties.write', 'properties.delete', 'leads.read', 'leads.write', 'leads.assign', 'users.read', 'users.write', 'billing.manage', 'website.write', 'domains.manage', 'analytics.advanced', 'compliance.read', 'compliance.write', 'crm.configure', 'crm.export', 'messaging.manage', 'whatsapp.manage'],
  agency_admin: ['properties.read', 'properties.write', 'properties.delete', 'leads.read', 'leads.write', 'leads.assign', 'users.read', 'users.write', 'website.write', 'analytics.advanced', 'compliance.read', 'crm.configure', 'crm.export', 'messaging.manage', 'whatsapp.manage'],
  agent: ['properties.read', 'properties.write', 'leads.read', 'leads.write'],
  viewer: ['properties.read', 'leads.read'], user: ['properties.read'], 'super-admin': [],
}

const authenticate = async (req: Request): Promise<void> => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.cookies?.[config.security.access_cookie_name]
  if (!token) throw new ApiError(401, 'Authentication required')
  let payload: any
  try { payload = jwtHelpers.verifyToken(token, config.jwt.secret as Secret) } catch { throw new ApiError(401, 'Invalid or expired access token') }
  const user = await User.findById(payload._id).select('_id email phoneNumber userRole organizationId status isVerified').lean()
  if (!user || user.status !== 'active' || !user.isVerified) throw new ApiError(401, 'Account is unavailable')
  if (payload.organizationId !== user.organizationId) throw new ApiError(401, 'Token tenant mismatch')
  req.user = { _id: user._id.toString(), email: user.email, phoneNumber: user.phoneNumber, userRole: user.userRole, organizationId: user.organizationId }
  if (user.userRole !== 'super-admin') req.tenant = { organizationId: user.organizationId, userId: user._id.toString(), role: user.userRole, permissions: matrix[user.userRole] || [] }
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
