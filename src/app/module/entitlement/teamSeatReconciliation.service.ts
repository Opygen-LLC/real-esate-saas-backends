import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { AuthSession } from '../auth/authSession.model'
import { writeAudit } from '../audit/audit.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { User } from '../user/user.model'
import { TEAM_MEMBER_SEAT_ROLES, teamSeatRolePriority } from './teamSeat.contract'

export interface TeamSeatReconciliationResult {
  organizationId: string
  maxTeamMembers: number
  protectedOwnerUserId: string | null
  blockedUserIds: string[]
  unblockedUserIds: string[]
  revokedInvitationIds: string[]
  teamMembersUsed: number
  teamMembersReserved: number
}

const SELECTION_POLICY = 'canonical_owner>agency_admin>agent>staff>viewer>oldest_membership>id'
const sessionOptions = (session?: ClientSession) => session ? { session } : undefined

const compareMembers = (left: any, right: any) => {
  const roleDiff = teamSeatRolePriority(left.userRole) - teamSeatRolePriority(right.userRole)
  if (roleDiff !== 0) return roleDiff
  const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0
  const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0
  if (leftCreated !== rightCreated) return leftCreated - rightCreated
  return String(left._id).localeCompare(String(right._id))
}

const resolveCanonicalOwner = (users: any[], organizationOwnerId?: unknown) => {
  const persistedOwnerId = organizationOwnerId ? String(organizationOwnerId) : ''
  if (persistedOwnerId) {
    const persistedOwner = users.find((user) => String(user._id) === persistedOwnerId)
    if (persistedOwner) return { user: persistedOwner, usedFallback: false }
  }

  // Legacy organizations can pre-date ownerId. Protect exactly one deterministic
  // agency_owner in that case; additional agency_owner records are normal seat
  // consumers and can be quota-blocked like any other member.
  const fallback = users
    .filter((user) => user.userRole === 'agency_owner')
    .sort(compareMembers)[0]
  return { user: fallback || null, usedFallback: Boolean(fallback) }
}

/**
 * Reconciles tenant-wide team seats against an already-resolved effective limit.
 *
 * Invariants:
 * - Exactly the canonical agency owner is protected from subscription blocking.
 * - Other roles (and any duplicate/legacy owner-role record) consume normal seats.
 * - Existing non-blocked members take priority over pending invitations.
 * - Member selection is deterministic: owner, role priority, oldest membership, id.
 * - Only users blocked specifically by `subscription_quota` can be auto-restored.
 * - Tenant/platform/manual/legacy restrictions are never auto-cleared.
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

  const canonicalOwner = resolveCanonicalOwner(users, organization.ownerId)
  const protectedOwnerUserId = canonicalOwner.user ? String(canonicalOwner.user._id) : null
  const normalSeatMembers = protectedOwnerUserId
    ? users.filter((user) => String(user._id) !== protectedOwnerUserId)
    : [...users]

  // Reserve exactly one seat for the canonical owner even while a platform action
  // temporarily blocks that account. This prevents a later explicit owner
  // reactivation from taking the tenant above its paid capacity.
  const ownerCommitment = protectedOwnerUserId ? 1 : 0
  const memberCapacity = Math.max(0, maxTeamMembers - ownerCommitment)

  const currentlyCommitted = normalSeatMembers
    .filter((user) => user.status !== 'blocked')
    .sort(compareMembers)

  const keepCommitted = currentlyCommitted.slice(0, memberCapacity)
  const overflowCommitted = currentlyCommitted.slice(memberCapacity)
  const blockedUserIds = overflowCommitted.map((user) => String(user._id))

  if (blockedUserIds.length) {
    const operations = overflowCommitted.map((user) => ({
      updateOne: {
        filter: { _id: user._id, organizationId },
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

  // Existing members take priority over pending invitations. On an upgrade,
  // previously quota-blocked members are restored before reservation capacity is
  // assigned to invitations. No other restriction provenance is auto-restored.
  const nonOwnerCommittedAfterBlock = keepCommitted.length
  let remainingCapacity = Math.max(0, maxTeamMembers - ownerCommitment - nonOwnerCommittedAfterBlock)

  const quotaBlocked = normalSeatMembers
    .filter((user) => user.status === 'blocked' && user.accessRestriction?.source === 'subscription_quota')
    .sort(compareMembers)
  const normalizedPreviousLimit = previousMaxTeamMembers === undefined
    ? undefined
    : Math.max(1, Math.floor(Number(previousMaxTeamMembers || 0)))
  const limitIncreased = normalizedPreviousLimit !== undefined && maxTeamMembers > normalizedPreviousLimit
  const toRestore = limitIncreased ? quotaBlocked.slice(0, remainingCapacity) : []
  const unblockedUserIds = toRestore.map((user) => String(user._id))
  if (toRestore.length) {
    const operations = toRestore.map((user) => ({
      updateOne: {
        filter: {
          _id: user._id,
          organizationId,
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
  const limitChanged = normalizedPreviousLimit !== undefined && normalizedPreviousLimit !== maxTeamMembers
  if (limitChanged || blockedUserIds.length || unblockedUserIds.length || revokedInvitationIds.length) {
    await writeAudit({
      organizationId,
      actorId,
      actorRole: actorId.startsWith('system:') || actorId === 'system' ? 'system' : undefined,
      action: 'subscription.team_seats_reconciled',
      entityType: 'organization',
      entityId: String(organization._id),
      reason,
      metadata: {
        previousMaxTeamMembers: normalizedPreviousLimit ?? null,
        maxTeamMembers,
        protectedOwnerUserId,
        ownerFallbackUsed: canonicalOwner.usedFallback,
        selectionPolicy: SELECTION_POLICY,
        blockedUserIds,
        unblockedUserIds,
        revokedInvitationIds,
        teamMembersUsed,
        teamMembersReserved,
      },
    }, session)
  }

  return {
    organizationId,
    maxTeamMembers,
    protectedOwnerUserId,
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
