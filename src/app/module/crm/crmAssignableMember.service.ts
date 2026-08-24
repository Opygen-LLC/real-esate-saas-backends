import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { effectivePermissionsForUser, type Permission } from '../user/accessControl'
import { User } from '../user/user.model'

export const CRM_ASSIGNMENT_CAPABILITIES = ['lead', 'contact', 'task', 'viewing', 'property'] as const
export type CrmAssignmentCapability = typeof CRM_ASSIGNMENT_CAPABILITIES[number]

const REQUIRED_PERMISSIONS: Record<CrmAssignmentCapability, readonly Permission[]> = {
  lead: ['leads.read', 'leads.write'],
  contact: ['contacts.read', 'contacts.write'],
  task: ['tasks.read', 'tasks.write'],
  viewing: ['viewings.read', 'viewings.write'],
  property: ['properties.read', 'properties.write'],
}

export const requiredPermissionsForCrmAssignmentCapability = (capability: CrmAssignmentCapability): readonly Permission[] =>
  REQUIRED_PERMISSIONS[capability]

const CAPABILITY_LABEL: Record<CrmAssignmentCapability, string> = {
  lead: 'lead',
  contact: 'contact',
  task: 'task',
  viewing: 'viewing',
  property: 'property',
}

export const normalizeCrmAssignmentCapability = (value: unknown): CrmAssignmentCapability => {
  const normalized = String(value || 'lead').trim().toLowerCase()
  if ((CRM_ASSIGNMENT_CAPABILITIES as readonly string[]).includes(normalized)) return normalized as CrmAssignmentCapability
  throw new ApiError(400, `Unsupported CRM assignee capability: ${normalized || 'empty'}`)
}

export const memberCanReceiveCapability = (
  member: { userRole?: string; profile?: { accessControl?: { useRoleDefaults?: boolean; permissions?: string[] } } | null },
  capability: CrmAssignmentCapability,
): boolean => {
  const permissions = effectivePermissionsForUser({
    userRole: member.userRole,
    accessControl: member.profile?.accessControl || undefined,
  })
  return REQUIRED_PERMISSIONS[capability].every((permission) => permissions.includes(permission))
}

type ListAssignableOptions = {
  ids?: unknown[]
  session?: ClientSession | null
}

const listAssignableMembers = async (
  organizationId: string,
  capability: CrmAssignmentCapability = 'lead',
  options: ListAssignableOptions = {},
): Promise<any[]> => {
  const query: any = {
    organizationId,
    status: 'active',
    ...(options.ids?.length ? { _id: { $in: options.ids } } : {}),
  }
  let userQuery = User.find(query)
    .select('_id name email phoneNumber userRole status createdAt')
    .populate({ path: 'profile', select: 'profileImgURL accessControl' })
    .sort({ name: 1, createdAt: 1 })
  if (options.session) userQuery = userQuery.session(options.session)
  const rows: any[] = await userQuery.lean()
  return rows.filter((row) => memberCanReceiveCapability(row, capability))
}

const listAssignableMembersForCapabilities = async (
  organizationId: string,
  capabilities: CrmAssignmentCapability[],
  options: ListAssignableOptions = {},
): Promise<any[]> => {
  const uniqueCapabilities = [...new Set(capabilities)]
  if (!uniqueCapabilities.length) return []
  const rows = await listAssignableMembers(organizationId, uniqueCapabilities[0], options)
  return rows.filter((row) => uniqueCapabilities.slice(1).every((capability) => memberCanReceiveCapability(row, capability)))
}

const getAssignableMemberForCapabilities = async (
  organizationId: string,
  memberId: string,
  capabilities: CrmAssignmentCapability[],
  session?: ClientSession | null,
): Promise<any | null> => {
  const rows = await listAssignableMembersForCapabilities(organizationId, capabilities, { ids: [memberId], session })
  return rows[0] || null
}

const getAssignableMember = async (
  organizationId: string,
  memberId: string,
  capability: CrmAssignmentCapability = 'lead',
  session?: ClientSession | null,
): Promise<any | null> => {
  const rows = await listAssignableMembers(organizationId, capability, { ids: [memberId], session })
  return rows[0] || null
}

const assertAssignableMember = async (
  organizationId: string,
  memberId: string,
  capability: CrmAssignmentCapability = 'lead',
  session?: ClientSession | null,
): Promise<any> => {
  const member = await getAssignableMember(organizationId, memberId, capability, session)
  if (!member) {
    throw new ApiError(400, `Assigned team member must be active in this agency and have ${CAPABILITY_LABEL[capability]} read/manage access`)
  }
  return member
}

const assertAssignableMemberIds = async (
  organizationId: string,
  memberIds: string[],
  capability: CrmAssignmentCapability = 'lead',
  session?: ClientSession | null,
): Promise<void> => {
  const uniqueIds = [...new Set(memberIds.filter(Boolean).map(String))]
  if (!uniqueIds.length) return
  const members = await listAssignableMembers(organizationId, capability, { ids: uniqueIds, session })
  const found = new Set(members.map((member) => String(member._id)))
  if (found.size !== uniqueIds.length || uniqueIds.some((id) => !found.has(id))) {
    throw new ApiError(400, `Assignment rules contain a team member who is inactive, outside this agency, or lacks ${CAPABILITY_LABEL[capability]} read/manage access`)
  }
}

export const CrmAssignableMemberService = {
  normalizeCapability: normalizeCrmAssignmentCapability,
  listAssignableMembers,
  listAssignableMembersForCapabilities,
  getAssignableMember,
  getAssignableMemberForCapabilities,
  assertAssignableMember,
  assertAssignableMemberIds,
}
