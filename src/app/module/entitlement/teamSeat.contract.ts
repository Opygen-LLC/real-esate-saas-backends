import type { IUserRole } from '../user/user.interface'

export const TEAM_MEMBER_SEAT_ROLES = ['agency_owner', 'agency_admin', 'agent', 'staff', 'viewer'] as const
export type TeamMemberSeatRole = (typeof TEAM_MEMBER_SEAT_ROLES)[number]

export const TEAM_SEAT_RESTRICTION_SOURCES = ['subscription_quota', 'tenant_admin', 'platform_admin'] as const
export type TeamSeatRestrictionSource = (typeof TEAM_SEAT_RESTRICTION_SOURCES)[number]

export const isTeamMemberSeatRole = (role: IUserRole | string): role is TeamMemberSeatRole =>
  (TEAM_MEMBER_SEAT_ROLES as readonly string[]).includes(role)

const ROLE_PRIORITY: Record<TeamMemberSeatRole, number> = {
  agency_owner: 0,
  agency_admin: 1,
  agent: 2,
  staff: 3,
  viewer: 4,
}

export const teamSeatRolePriority = (role: IUserRole | string): number =>
  isTeamMemberSeatRole(role) ? ROLE_PRIORITY[role] : Number.MAX_SAFE_INTEGER
