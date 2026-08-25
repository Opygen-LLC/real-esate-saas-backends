import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { AuthSession } from '../auth/authSession.model'
import { OtpChallenge } from '../auth/otpChallenge.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SuperAdminProfile } from '../superAdminProfile/superAdminProfile.model'
import { User } from '../user/user.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { ImpersonationSession } from '../platformAdmin/impersonationSession.model'
import { TENANT_DELETION_COLLECTIONS } from './tenantDataCollections'

const withSession = (session?: ClientSession) => (session ? { session } : undefined)

const getTenantUserIds = async (organizationId: string, session?: ClientSession) => {
  const query = User.find({ organizationId }).select('_id userRole').lean()
  if (session) query.session(session)
  const users = await query
  if (users.some((user: any) => user.userRole === 'super-admin')) {
    throw new ApiError(httpStatus.CONFLICT, 'Organizations containing a Super Admin account cannot be permanently deleted')
  }
  return users.map((user: any) => user._id)
}

const countUserLinkedDocuments = async (userIds: any[]) => {
  if (!userIds.length) return { total: 0, additionalToTenantScoped: 0 }
  const filter = { userId: { $in: userIds } }
  const [accountCredentials, authSessions, otpChallenges, userProfiles, ownerProfiles, agentProfiles, superAdminProfiles] = await Promise.all([
    AccountCredential.countDocuments(filter),
    AuthSession.countDocuments(filter),
    OtpChallenge.countDocuments(filter),
    UserProfile.countDocuments(filter),
    AgencyOwnerProfile.countDocuments(filter),
    AgentProfile.countDocuments(filter),
    SuperAdminProfile.countDocuments(filter),
  ])
  return {
    total: accountCredentials + authSessions + otpChallenges + userProfiles + ownerProfiles + agentProfiles + superAdminProfiles,
    // authSessions and otpChallenges are already included in the tenant-scoped
    // collection registry; the remaining user-linked records are not.
    additionalToTenantScoped: accountCredentials + userProfiles + ownerProfiles + agentProfiles + superAdminProfiles,
  }
}

const getCollectionCounts = async (organizationId: string) => {
  const entries = await Promise.all(TENANT_DELETION_COLLECTIONS.map(async (name) => {
    try {
      const count = await mongoose.connection.collection(name).countDocuments({ organizationId })
      return [name, count] as const
    } catch {
      return [name, 0] as const
    }
  }))
  return Object.fromEntries(entries) as Record<string, number>
}

const previewOrganization = async (organizationId: string) => {
  const org: any = await Organization.findOne({ organizationId }).select('_id organizationId agencyName platformAccess').lean()
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const userIds = await getTenantUserIds(organizationId)
  const [collectionCounts, userLinked] = await Promise.all([
    getCollectionCounts(organizationId),
    countUserLinkedDocuments(userIds),
  ])
  const scopedDocuments = Object.values(collectionCounts).reduce((sum, count) => sum + Number(count || 0), 0)

  return {
    organizationId,
    agencyName: org.agencyName,
    accessStatus: String(org.platformAccess?.status || 'active'),
    immediate: true,
    permanent: true,
    recoverable: false,
    dataSummary: {
      totalTenantDocuments: scopedDocuments + userLinked.additionalToTenantScoped + 1,
      userLinkedDocuments: userLinked.total,
      users: Number(collectionCounts.users || 0),
      properties: Number(collectionCounts.properties || 0),
      leads: Number(collectionCounts.leads || 0),
      contacts: Number(collectionCounts.contacts || 0),
      payments: Number(collectionCounts.subscriptionpayments || 0) + Number(collectionCounts.bkashpayments || 0),
      domains: Number(collectionCounts.domainrecords || 0),
      pendingInvitations: Number(collectionCounts.teaminvitations || 0),
      auditEvents: Number(collectionCounts.auditevents || 0),
      dataSubjectRequests: Number(collectionCounts.datasubjectrequests || 0),
      collectionCounts,
    },
  }
}

const deleteUserLinkedDocuments = async (userIds: any[], session?: ClientSession) => {
  if (!userIds.length) return
  const filter = { userId: { $in: userIds } }
  const options = withSession(session)
  await Promise.all([
    AccountCredential.deleteMany(filter, options),
    AuthSession.deleteMany(filter, options),
    OtpChallenge.deleteMany(filter, options),
    UserProfile.deleteMany(filter, options),
    AgencyOwnerProfile.deleteMany(filter, options),
    AgentProfile.deleteMany(filter, options),
    SuperAdminProfile.deleteMany(filter, options),
  ])
}

const deleteTenantCollections = async (organizationId: string, session?: ClientSession) => {
  const options = withSession(session)
  for (const name of TENANT_DELETION_COLLECTIONS) {
    await mongoose.connection.collection(name).deleteMany({ organizationId }, options)
  }
  await Organization.deleteOne({ organizationId }, options)
}

const verifyPurged = async (organizationId: string, userIds: any[]) => {
  const [organizationExists, collectionCounts, userLinked] = await Promise.all([
    Organization.exists({ organizationId }),
    getCollectionCounts(organizationId),
    countUserLinkedDocuments(userIds),
  ])
  const remainingCollections = Object.entries(collectionCounts)
    .filter(([, count]) => count > 0)
    .reduce<Record<string, number>>((acc, [name, count]) => { acc[name] = count; return acc }, {})

  if (organizationExists || userLinked.total > 0 || Object.keys(remainingCollections).length > 0) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'TENANT_PURGE_INCOMPLETE')
  }
}

const purgeOrganization = async (organizationId: string, actor: { id: string; reason: string }) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const userIds = await getTenantUserIds(organizationId)
  const now = new Date()

  // Immediately block the workspace before destructive work starts. If any
  // later step fails, the same hard-delete endpoint is safe to retry.
  org.isBlocked = true
  org.websiteStatus = 'suspended'
  if (org.subscription) org.subscription.status = 'suspended'
  org.platformAccess = {
    ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
    status: 'pending_deletion',
    deletionRequestedAt: now,
    deletionRequestedBy: actor.id,
    deletionReason: actor.reason,
    deletionRequestId: null,
    deletionRetentionUntil: null,
  }
  await org.save()

  await Promise.all([
    AuthSession.updateMany({ organizationId, revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'tenant_hard_delete' } }),
    ImpersonationSession.updateMany({ organizationId, endedAt: null }, { $set: { endedAt: now, endedBy: actor.id } }),
    CacheInvalidationService.invalidateTenant(organizationId),
  ])
  RealtimeService.emitOrganization(organizationId, { type: 'auth.changed', action: 'revoked', entityId: 'organization_hard_delete', forceLogout: true })
  await Promise.all(userIds.map((userId) => RealtimeService.disconnectUser(String(userId))))

  const execute = async (session?: ClientSession) => {
    await deleteUserLinkedDocuments(userIds, session)
    await deleteTenantCollections(organizationId, session)
  }

  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => execute(session))
    } finally {
      await session.endSession()
    }
  } else {
    // Standalone MongoDB cannot provide all-or-nothing deletion, so each delete
    // remains tenant-scoped/idempotent and the final zero-data verification is
    // mandatory before success is returned.
    await execute()
  }

  await verifyPurged(organizationId, userIds)
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'deleted', entityId: organizationId })

  return { organizationId, deleted: true, permanent: true }
}

export const TenantPurgeService = { previewOrganization, purgeOrganization }
