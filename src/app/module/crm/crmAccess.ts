import type { Request } from 'express'
import ApiError from '../../../errors/ApiError'

export type CrmRecordScope = 'mine' | 'team'

export type CrmAccessContext = {
  userId: string
  role: string
  permissions: string[]
  isManager: boolean
  canReadTeam: boolean
  scope: CrmRecordScope
}

const CRM_MANAGER_ROLES = new Set(['agency_owner', 'agency_admin', 'admin'])

export const isCrmManagerRole = (role?: string): boolean => CRM_MANAGER_ROLES.has(String(role || ''))

export const hasCrmPermission = (access: Pick<CrmAccessContext, 'permissions'> | undefined, permission: string): boolean =>
  Boolean(access?.permissions?.includes(permission))

export const crmAccessFromRequest = (req: Request, requestedScope?: unknown): CrmAccessContext => {
  const userId = String(req.tenant?.userId || req.user?._id || req.user?.id || '')
  const role = String(req.tenant?.role || req.user?.userRole || '')
  const permissions = [...(req.tenant?.permissions || req.user?.permissions || [])]
  if (!userId) throw new ApiError(403, 'Authenticated CRM user context is required')

  const isManager = isCrmManagerRole(role)
  const canReadTeam = isManager || permissions.includes('crm.team.read')
  let requested = String(requestedScope || '').trim().toLowerCase()
  if (requested.startsWith('team')) requested = 'team'
  else if (requested.startsWith('mine')) requested = 'mine'
  if (requested && requested !== 'mine' && requested !== 'team') {
    throw new ApiError(400, 'CRM scope must be either mine or team')
  }

  if (requested === 'team' && !canReadTeam) {
    throw new ApiError(403, 'Team-wide CRM visibility requires crm.team.read')
  }

  // Owners/admins see the agency by default. Team members remain scoped to their
  // own records unless they explicitly request team scope and have crm.team.read.
  const scope: CrmRecordScope = requested === 'mine'
    ? 'mine'
    : requested === 'team'
      ? 'team'
      : isManager
        ? 'team'
        : 'mine'

  return { userId, role, permissions, isManager, canReadTeam, scope }
}


export const crmRecordReadAccessFromRequest = (req: Request): CrmAccessContext => {
  const access = crmAccessFromRequest(req)
  return access.canReadTeam ? { ...access, scope: 'team' } : access
}

export const crmReadOwnerFilter = (field: string, access?: CrmAccessContext): Record<string, unknown> => {
  if (!access || access.scope === 'team') return {}
  return { [field]: access.userId }
}

export const crmMutationOwnerFilter = (field: string, access?: CrmAccessContext): Record<string, unknown> => {
  if (!access || access.isManager) return {}
  return { [field]: access.userId }
}

export const canAssignLeadTo = (access: CrmAccessContext | undefined, assignedAgent?: string): boolean => {
  if (!access || access.isManager || !assignedAgent || assignedAgent === access.userId) return true
  return access.permissions.includes('leads.assign')
}
