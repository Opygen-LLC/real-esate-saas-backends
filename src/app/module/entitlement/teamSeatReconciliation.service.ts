import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { AuthSession } from '../auth/authSession.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { User } from '../user/user.model'
import { TEAM_MEMBER_SEAT_ROLES, teamSeatRolePriority } from './teamSeat.contract'

export interface TeamSeatReconciliationResult {
  organizationId: string
  maxTeamMembers: number
  blockedUserIds: string[]
  unblockedUserIds: string[]
  revokedInvitationIds: string[]
  teamMembersUsed: number
  teamMembersReserved: number
}

const sessionOptions = (session?: ClientSession) => session ? { session } : undefined

const compareMembers = (left: any, right: any) => {
  const roleDiff = teamSeatRolePriority(left.userRole) - teamSeatRolePriority(right.userRole)
  if (roleDiff !== 0) return roleDiff
  const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0
  const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0
  if (leftCreated !== rightCreated) return leftCreated - rightCreated
  return String(left._id).localeCompare(String(right._id))
}

/**
 * Reconciles tenant-wide team seats against an already-resolved effective limit.
 *
 * Invariants:
 * - The agency owner is never blocked by subscription quota reconciliation.
 * - Existing non-blocked members take priority over pending invitations.
 * - Only users blocked specifically by `subscription_quota` can be auto-restored.
 * - Tenant/platform/manual restrictions are never auto-cleared.
 * - Overflow data is preserved; only access is restricted and sessions are revoked.
 *
 * Callers that change a plan should invoke this in the same transaction/session as
 * the effective plan mutation whenever transactions are available.
 */
export const reconcileTeamSeats = async (
  organizationId: string,
  maxTeamMembersInput: number,
  options: { session?: ClientSession; actorId?: string; reason?: string; previousMaxTeamMembers?: number } = {},
): Promise<TeamSeatReconciliationResult> => {
  const maxTeamMembers = Math.max(1, Math.floor(Number(maxTeamMembersInput || 0)))
  const now = new Date()
  const { session, actorId = 'system', reason = 'Subscription team-seat limit changed', previousMaxTeamMembers } = options

  const orgQuery = Organization.findOne({ organizationId }).select('_id ownerId organizationId')
  if (session) orgQuery.session(session)
  const organization: any = await orgQuery.lean()
  if (!organization) throw new ApiError(404, 'Organization not found')

  const userQuery = User.find({
    organizationId,
    userRole: { $in: [...TEAM_MEMBER_SEAT_ROLES] },
  }).select('_id userRole status accessRestriction createdAt')
  if (session) userQuery.session(session)
  const users: any[] = await userQuery.lean()

  const ownerId = String(organization.ownerId || users.find((user) => user.userRole === 'agency_owner')?._id || '')
  const protectedOwners = users.filter((user) => user.userRole === 'agency_owner' || String(user._id) === ownerId)
  const nonOwners = users.filter((user) => !protectedOwners.some((owner) => String(owner._id) === String(user._id)))

  // Reserve one seat for the canonical owner even if the owner is temporarily
  // restricted by a platform action. That prevents a later owner reactivation
  // from silently taking the tenant above the subscribed capacity.
  const memberCapacity = Math.max(0, maxTeamMembers - 1)

  const currentlyCommitted = nonOwners
    .filter((user) => user.status !== 'blocked')
    .sort(compareMembers)

  const keepCommitted = currentlyCommitted.slice(0, memberCapacity)
  const overflowCommitted = currentlyCommitted.slice(memberCapacity)
  const blockedUserIds = overflowCommitted.map((user) => String(user._id))

  if (blockedUserIds.length) {
    const operations = overflowCommitted.map((user) => ({
      updateOne: {
        filter: { _id: user._id, organizationId, userRole: { $ne: 'agency_owner' } },
        update: {
          $set: {
            status: 'blocked',
            accessRestriction: {
              source: 'subscription_quota',
              reason,
              blockedAt: now,
              blockedBy: actorId,
              previousStatus: user.status === 'pending' ? 'pending' : 'active',
            },
          },
        },
      },
    }))
    await User.bulkWrite(operations as any, sessionOptions(session))
    await AuthSession.updateMany(
      { userId: { $in: overflowCommitted.map((user) => user._id) }, revokedAt: null },
      { $set: { revokedAt: now, revokeReason: 'subscription_quota' } },
      sessionOptions(session),
    )
  }

  // The owner always consumes one protected seat. Existing members also take
  // priority over pending invitations. On an upgrade, previously quota-blocked
  // members are restored before invitation reservations are retained.
  const ownerCommitment = 1
  const nonOwnerCommittedAfterBlock = keepCommitted.length
  let remainingCapacity = Math.max(0, maxTeamMembers - ownerCommitment - nonOwnerCommittedAfterBlock)

  const quotaBlocked = nonOwners
    .filter((user) => user.status === 'blocked' && user.accessRestriction?.source === 'subscription_quota')
    .sort(compareMembers)
  const limitIncreased = previousMaxTeamMembers !== undefined
    && maxTeamMembers > Math.max(1, Math.floor(Number(previousMaxTeamMembers || 0)))
  const toRestore = limitIncreased ? quotaBlocked.slice(0, remainingCapacity) : []
  const unblockedUserIds = toRestore.map((user) => String(user._id))
  if (toRestore.length) {
    const operations = toRestore.map((user) => ({
      updateOne: {
        filter: {
          _id: user._id,
          organizationId,
          userRole: { $ne: 'agency_owner' },
          status: 'blocked',
          'accessRestriction.source': 'subscription_quota',
        },
        update: {
          $set: { status: user.accessRestriction?.previousStatus === 'pending' ? 'pending' : 'active' },
          $unset: { accessRestriction: '' },
        },
      },
    }))
    await User.bulkWrite(operations as any, sessionOptions(session))
  }

  remainingCapacity = Math.max(0, remainingCapacity - toRestore.length)

  const inviteQuery = TeamInvitation.find({ organizationId, status: 'pending', expiresAt: { $gt: now } })
    .select('_id createdAt')
    .sort({ createdAt: 1, _id: 1 })
  if (session) inviteQuery.session(session)
  const invitations: any[] = await inviteQuery.lean()
  const keptInvitations = invitations.slice(0, remainingCapacity)
  const overflowInvitations = invitations.slice(remainingCapacity)
  const revokedInvitationIds = overflowInvitations.map((invite) => String(invite._id))
  if (revokedInvitationIds.length) {
    await TeamInvitation.updateMany(
      { _id: { $in: overflowInvitations.map((invite) => invite._id) }, organizationId, status: 'pending' },
      { $set: { status: 'revoked' } },
      sessionOptions(session),
    )
  }

  const teamMembersUsed = ownerCommitment + nonOwnerCommittedAfterBlock + toRestore.length
  const teamMembersReserved = keptInvitations.length

  return {
    organizationId,
    maxTeamMembers,
    blockedUserIds,
    unblockedUserIds,
    revokedInvitationIds,
    teamMembersUsed,
    teamMembersReserved,
  }
}

/** Run after the transaction that produced the reconciliation has committed. */
export const publishTeamSeatReconciliation = async (result?: TeamSeatReconciliationResult | null) => {
  if (!result) return
  await CacheInvalidationService.invalidateTenant(result.organizationId)
  for (const userId of result.blockedUserIds) {
    RealtimeService.emitAuthorizationChanged({
      userId,
      organizationId: result.organizationId,
      forceLogout: true,
      reason: 'subscription_quota',
    })
    RealtimeService.emitOrganization(result.organizationId, { type: 'team.changed', action: 'updated', entityId: userId })
  }
  for (const userId of result.unblockedUserIds) {
    RealtimeService.emitAuthorizationChanged({
      userId,
      organizationId: result.organizationId,
      forceLogout: false,
      reason: 'subscription_quota_released',
    })
    RealtimeService.emitOrganization(result.organizationId, { type: 'team.changed', action: 'updated', entityId: userId })
  }
  if (result.revokedInvitationIds.length) {
    RealtimeService.emitOrganization(result.organizationId, { type: 'team.changed', action: 'updated', entityId: 'pending-invitations' })
  }
}
