import httpStatus from 'http-status'
import mongoose, { type ClientSession, type Types } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { AuthSession } from '../auth/authSession.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import { ImpersonationSession } from '../platformAdmin/impersonationSession.model'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { RealtimeService } from '../realtime/realtime.service'
import { User } from '../user/user.model'
import {
  PROTECTED_ORGANIZATION_IDS,
  PROTECTED_PLATFORM_COLLECTIONS,
  TENANT_DELETION_COLLECTIONS,
  USER_LINKED_DELETION_COLLECTIONS,
} from './tenantDataCollections'
import { TenantExternalResourcesService } from './tenantExternalResources.service'

const USER_COLLECTION = 'users'
const ORGANIZATION_COLLECTION = 'organizations'

const withSession = (session?: ClientSession) => (session ? { session } : undefined)
const protectedOrganizationIds = new Set<string>(PROTECTED_ORGANIZATION_IDS)
const protectedPlatformCollections = new Set<string>(PROTECTED_PLATFORM_COLLECTIONS)
const tenantDeletionCollections = new Set<string>(TENANT_DELETION_COLLECTIONS)

const assertDeletionRegistrySafety = () => {
  if (tenantDeletionCollections.has(ORGANIZATION_COLLECTION)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Tenant deletion registry must not contain the organizations collection')
  }

  const protectedCollision = [...TENANT_DELETION_COLLECTIONS, ...USER_LINKED_DELETION_COLLECTIONS]
    .find((name) => protectedPlatformCollections.has(name))

  if (protectedCollision) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Tenant deletion registry contains protected platform collection: ${protectedCollision}`,
      '',
      'TENANT_PURGE_REGISTRY_UNSAFE',
    )
  }
}

const assertOrganizationIdIsPurgeable = (organizationId: string) => {
  const normalized = String(organizationId || '').trim()
  if (!normalized) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization id is required')
  if (protectedOrganizationIds.has(normalized)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Platform/system organizations cannot be permanently deleted')
  }
  return normalized
}

const getTenantUserIds = async (organizationId: string, session?: ClientSession): Promise<Types.ObjectId[]> => {
  const query = User.find({ organizationId }).select('_id userRole').lean()
  if (session) query.session(session)
  const users = await query

  if (users.some((user: any) => user.userRole === 'super-admin')) {
    throw new ApiError(httpStatus.CONFLICT, 'Organizations containing a Super Admin account cannot be permanently deleted')
  }

  return users.map((user: any) => user._id as Types.ObjectId)
}

const mergePurgeUserIds = (stored: unknown, current: Types.ObjectId[]): Types.ObjectId[] => {
  const values = new Set<string>()
  for (const value of Array.isArray(stored) ? stored : []) {
    const normalized = String(value || '').trim()
    if (mongoose.isValidObjectId(normalized)) values.add(normalized)
  }
  for (const value of current) values.add(String(value))
  return [...values].map((value) => new mongoose.Types.ObjectId(value))
}

const tenantOrUserFilter = (organizationId: string, userIds: Types.ObjectId[]) => userIds.length
  ? { $or: [{ organizationId }, { userId: { $in: userIds } }] }
  : { organizationId }

const countCollection = async (collectionName: string, filter: Record<string, unknown>) =>
  mongoose.connection.collection(collectionName).countDocuments(filter)

const getTenantCollectionCounts = async (organizationId: string) => {
  const entries = await Promise.all(TENANT_DELETION_COLLECTIONS.map(async (name) => {
    const count = await countCollection(name, { organizationId })
    return [name, count] as const
  }))
  return Object.fromEntries(entries) as Record<string, number>
}

const getUserLinkedCollectionCounts = async (userIds: Types.ObjectId[], organizationId: string) => {
  if (!userIds.length) {
    return {
      collectionCounts: {} as Record<string, number>,
      total: 0,
      additionalToTenantScoped: 0,
    }
  }

  const entries = await Promise.all(USER_LINKED_DELETION_COLLECTIONS.map(async (name) => {
    const count = await countCollection(name, { userId: { $in: userIds } })
    return [name, count] as const
  }))
  const collectionCounts = Object.fromEntries(entries) as Record<string, number>
  const total = Object.values(collectionCounts).reduce((sum, count) => sum + Number(count || 0), 0)

  const additionalEntries = await Promise.all(USER_LINKED_DELETION_COLLECTIONS.map(async (name) => {
    if (!tenantDeletionCollections.has(name)) return [name, Number(collectionCounts[name] || 0)] as const

    // These rows are already counted by the organizationId registry when their
    // tenant scope is correct. Count only malformed/legacy rows here so the
    // deletion preview total remains a true record count instead of double
    // counting the same MongoDB document.
    const count = await countCollection(name, {
      userId: { $in: userIds },
      organizationId: { $ne: organizationId },
    })
    return [name, count] as const
  }))

  const additionalToTenantScoped = Object.values(Object.fromEntries(additionalEntries) as Record<string, number>)
    .reduce((sum, count) => sum + Number(count || 0), 0)

  return { collectionCounts, total, additionalToTenantScoped }
}

const sumCollectionCounts = (counts: Record<string, number>, names: readonly string[]) =>
  names.reduce((sum, name) => sum + Number(counts[name] || 0), 0)

const FINANCE_PREVIEW_COLLECTIONS = [
  'financetransactions',
  'financeinvoices',
  'financecommissions',
  'financevendors',
  'financebudgets',
] as const

const WEBSITE_PREVIEW_COLLECTIONS = [
  'banners',
  'sections',
  'landingpages',
  'websiteassets',
  'websitepages',
  'websiterevisions',
  'websitesubmissions',
  'websitepreviewtokens',
  'websiteuploadintents',
  'visitorlogs',
] as const

const DOMAIN_PREVIEW_COLLECTIONS = ['domainrecords', 'domainevents', 'subdomainaliases'] as const

const previewOrganization = async (rawOrganizationId: string) => {
  assertDeletionRegistrySafety()
  const organizationId = assertOrganizationIdIsPurgeable(rawOrganizationId)
  const org: any = await Organization.findOne({ organizationId }).select('_id organizationId agencyName platformAccess').lean()
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const userIds = await getTenantUserIds(organizationId)
  const [collectionCounts, userLinked, externalResources] = await Promise.all([
    getTenantCollectionCounts(organizationId),
    getUserLinkedCollectionCounts(userIds, organizationId),
    TenantExternalResourcesService.collect(organizationId, userIds),
  ])
  const scopedDocuments = Object.values(collectionCounts).reduce((sum, count) => sum + Number(count || 0), 0)
  // +1 is the Organization root document, which is intentionally deleted
  // last and therefore not part of TENANT_DELETION_COLLECTIONS.
  const totalTenantDocuments = scopedDocuments + userLinked.additionalToTenantScoped + 1
  const users = Number(collectionCounts.users || 0)
  const properties = Number(collectionCounts.properties || 0)
  const leads = Number(collectionCounts.leads || 0)
  const contacts = Number(collectionCounts.contacts || 0)
  const tasks = Number(collectionCounts.tasks || 0)
  const viewings = Number(collectionCounts.viewings || 0)
  const payments = Number(collectionCounts.subscriptionpayments || 0) + Number(collectionCounts.bkashpayments || 0)
  const financeRecords = sumCollectionCounts(collectionCounts, FINANCE_PREVIEW_COLLECTIONS)
  const websiteRecords = sumCollectionCounts(collectionCounts, WEBSITE_PREVIEW_COLLECTIONS)
  const domainDocuments = sumCollectionCounts(collectionCounts, DOMAIN_PREVIEW_COLLECTIONS)
  const auditEvents = Number(collectionCounts.auditevents || 0)
  const displayedDatabaseRecords = users + properties + leads + contacts + tasks + viewings + payments + financeRecords + websiteRecords + domainDocuments + auditEvents

  return {
    organizationId,
    agencyName: org.agencyName,
    accessStatus: String(org.platformAccess?.status || 'active'),
    immediate: true,
    permanent: true,
    recoverable: false,
    dataSummary: {
      totalTenantDocuments,
      userLinkedDocuments: userLinked.total,
      users,
      properties,
      leads,
      contacts,
      tasks,
      viewings,
      payments,
      financeRecords,
      websiteRecords,
      files: externalResources.referencedObjectKeys.length,
      domains: externalResources.domains.length,
      otherRecords: Math.max(0, totalTenantDocuments - displayedDatabaseRecords),
      pendingInvitations: Number(collectionCounts.teaminvitations || 0),
      auditEvents,
      dataSubjectRequests: Number(collectionCounts.datasubjectrequests || 0),
      externalResources: {
        storagePrefixes: externalResources.storagePrefixes,
        referencedStorageObjects: externalResources.referencedObjectKeys.length,
        legacyStorageObjects: externalResources.legacyObjectKeys.length,
        customDomains: externalResources.domains.length,
        activeSessions: await countCollection('authsessions', { ...tenantOrUserFilter(organizationId, userIds), revokedAt: null }),
        queuedOrProcessingJobs: await countCollection('operationsjobs', { organizationId, status: { $in: ['pending', 'processing'] } }),
      },
      collectionCounts,
      userLinkedCollectionCounts: userLinked.collectionCounts,
    },
  }
}

const deleteUserLinkedDocuments = async (userIds: Types.ObjectId[], session?: ClientSession) => {
  if (!userIds.length) return
  const options = withSession(session)
  const filter = { userId: { $in: userIds } }

  // Delete by userId before deleting User rows. This catches account/profile
  // records with no organizationId as well as malformed legacy auth/profile
  // rows whose tenant id no longer matches the owning user.
  for (const name of USER_LINKED_DELETION_COLLECTIONS) {
    await mongoose.connection.collection(name).deleteMany(filter, options)
  }
}

const deleteTenantScopedDocuments = async (organizationId: string, session?: ClientSession) => {
  const options = withSession(session)

  // Users are deleted explicitly after all tenant and user-linked dependants.
  for (const name of TENANT_DELETION_COLLECTIONS) {
    if (name === USER_COLLECTION) continue
    await mongoose.connection.collection(name).deleteMany({ organizationId }, options)
  }
}

const deleteTenantUsers = async (organizationId: string, session?: ClientSession) => {
  await User.deleteMany({ organizationId }, withSession(session))
}

const deleteOrganizationRoot = async (organizationId: string, session?: ClientSession) => {
  // The Organization is the final major MongoDB record removed. Keeping this
  // separate prevents losing the tenant root before dependent cleanup finishes.
  await Organization.deleteOne({ organizationId }, withSession(session))
}

const nonZero = (counts: Record<string, number>) => Object.entries(counts)
  .filter(([, count]) => Number(count || 0) > 0)
  .reduce<Record<string, number>>((acc, [name, count]) => {
    acc[name] = Number(count || 0)
    return acc
  }, {})

const getZeroStateSnapshot = async (
  organizationId: string,
  userIds: Types.ObjectId[],
  externalManifest: Awaited<ReturnType<typeof TenantExternalResourcesService.collect>>,
) => {
  const userIdStrings = userIds.map(String)
  const [organizationExists, collectionCounts, userLinked, external, organizationSockets, userSockets, redisKeys] = await Promise.all([
    Organization.exists({ organizationId }),
    getTenantCollectionCounts(organizationId),
    getUserLinkedCollectionCounts(userIds, organizationId),
    TenantExternalResourcesService.verificationState(externalManifest),
    RealtimeService.countOrganizationSockets(organizationId),
    RealtimeService.countUserSockets(userIdStrings),
    CacheInvalidationService.countTenantKeys(organizationId, externalManifest.cacheIdentifiers),
  ])
  const remainingCollections = nonZero(collectionCounts)
  const remainingUserLinkedCollections = nonZero(userLinked.collectionCounts)
  return {
    organizationExists: Boolean(organizationExists),
    remainingCollections,
    remainingUserLinkedCollections,
    databaseRecords: Object.values(remainingCollections).reduce((sum, value) => sum + value, 0)
      + Object.values(remainingUserLinkedCollections).reduce((sum, value) => sum + value, 0),
    activeSessions: Number(collectionCounts.authsessions || 0) + Number(userLinked.collectionCounts.authsessions || 0),
    operationsJobs: Number(collectionCounts.operationsjobs || 0),
    activeSockets: organizationSockets + userSockets,
    redisKeys,
    gcsTenantObjects: external.remainingStorageObjects,
    registeredTenantDomains: external.remainingDomainRegistrations,
    external,
  }
}

const assertZeroState = async (
  organizationId: string,
  userIds: Types.ObjectId[],
  externalManifest: Awaited<ReturnType<typeof TenantExternalResourcesService.collect>>,
  options: { organizationMustExist: boolean },
) => {
  const snapshot = await getZeroStateSnapshot(organizationId, userIds, externalManifest)
  const organizationMismatch = options.organizationMustExist ? !snapshot.organizationExists : snapshot.organizationExists
  const incomplete = organizationMismatch
    || snapshot.databaseRecords > 0
    || snapshot.activeSessions > 0
    || snapshot.operationsJobs > 0
    || snapshot.activeSockets > 0
    || snapshot.redisKeys > 0
    || snapshot.gcsTenantObjects > 0
    || snapshot.registeredTenantDomains > 0

  if (incomplete) {
    const details = { organizationId, expectedOrganizationExists: options.organizationMustExist, ...snapshot }
    logger.error('tenant_hard_delete_zero_state_verification_failed', details)
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant purge verification found remaining organization data or active resources',
      '',
      'TENANT_PURGE_INCOMPLETE',
      details,
    )
  }
  return snapshot
}

const deleteTenantDependants = async (organizationId: string, userIds: Types.ObjectId[]) => {
  const execute = async (session?: ClientSession) => {
    await deleteUserLinkedDocuments(userIds, session)
    await deleteTenantScopedDocuments(organizationId, session)
    await deleteTenantUsers(organizationId, session)
  }

  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => execute(session))
    } finally {
      await session.endSession()
    }
    return
  }
  await execute()
}

const convergePurgeBoundaries = async (
  organizationId: string,
  userIds: Types.ObjectId[],
  externalManifest: Awaited<ReturnType<typeof TenantExternalResourcesService.collect>>,
  actorId: string,
) => {
  const now = new Date()
  await Promise.all([
    AuthSession.updateMany(
      { ...tenantOrUserFilter(organizationId, userIds), revokedAt: null },
      { $set: { revokedAt: now, revokeReason: 'tenant_hard_delete' } },
    ),
    ImpersonationSession.updateMany(
      userIds.length
        ? { $or: [{ organizationId }, { targetUserId: { $in: userIds } }], endedAt: null }
        : { organizationId, endedAt: null },
      { $set: { endedAt: now, endedBy: actorId } },
    ),
    OperationsQueueService.cancelOrganization(organizationId),
    CacheInvalidationService.invalidateTenant(organizationId, externalManifest.cacheIdentifiers),
  ])

  RealtimeService.emitOrganization(organizationId, {
    type: 'auth.changed',
    action: 'revoked',
    entityId: 'organization_hard_delete',
    forceLogout: true,
  })
  await Promise.all([
    RealtimeService.disconnectOrganization(organizationId),
    RealtimeService.disconnectPublicOrganization(organizationId),
    ...userIds.map((userId) => RealtimeService.disconnectUser(String(userId))),
  ])

  // All operations below are intentionally idempotent. Re-running the purge is
  // safe if files/domains/sessions/jobs were already removed by an earlier try.
  await Promise.all([
    TenantExternalResourcesService.deleteStorage(externalManifest),
    TenantExternalResourcesService.deleteDomains(externalManifest),
  ])
  await TenantExternalResourcesService.verifyDeleted(externalManifest)
}

const purgeOrganization = async (rawOrganizationId: string, actor: { id: string; reason: string }) => {
  assertDeletionRegistrySafety()
  const organizationId = assertOrganizationIdIsPurgeable(rawOrganizationId)
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const currentUserIds = await getTenantUserIds(organizationId)
  const userIds = mergePurgeUserIds(org.platformAccess?.purgeUserIds, currentUserIds)
  const externalManifest = await TenantExternalResourcesService.collect(organizationId, userIds)
  const now = new Date()

  // Lock first. This state is checked by authenticated write middleware,
  // public-write barriers and background workers. The user-id manifest remains
  // only on this locked Organization root so a failed purge can be retried even
  // after the User documents themselves have already been deleted.
  org.isBlocked = true
  org.websiteStatus = 'suspended'
  if (org.subscription) org.subscription.status = 'suspended'
  org.platformAccess = {
    ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
    status: 'pending_deletion',
    deletionRequestedAt: org.platformAccess?.deletionRequestedAt || now,
    deletionRequestedBy: actor.id,
    deletionReason: actor.reason,
    deletionRequestId: null,
    deletionRetentionUntil: null,
    purgeUserIds: userIds.map(String),
  }
  await org.save()

  await convergePurgeBoundaries(organizationId, userIds, externalManifest, actor.id)

  // Remove tenant/user records, then converge once more to catch a request that
  // was already in flight when the lock was written. The Organization root is
  // deliberately retained until every dependent boundary verifies at zero.
  await deleteTenantDependants(organizationId, userIds)
  await convergePurgeBoundaries(organizationId, userIds, externalManifest, actor.id)
  await deleteTenantDependants(organizationId, userIds)

  await assertZeroState(organizationId, userIds, externalManifest, { organizationMustExist: true })

  // Organization is deleted last, after MongoDB, GCS, domains, sessions,
  // sockets, Redis and jobs have all converged to zero.
  await deleteOrganizationRoot(organizationId)

  // Final cache/socket convergence after the root disappears. This also catches
  // stale reads that repopulated cache keys during the destructive window.
  await Promise.all([
    CacheInvalidationService.invalidateTenant(organizationId, externalManifest.cacheIdentifiers),
    RealtimeService.disconnectOrganization(organizationId),
    RealtimeService.disconnectPublicOrganization(organizationId),
    ...userIds.map((userId) => RealtimeService.disconnectUser(String(userId))),
  ])

  const verification = await assertZeroState(organizationId, userIds, externalManifest, { organizationMustExist: false })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'deleted', entityId: organizationId })

  return {
    organizationId,
    deleted: true,
    permanent: true,
    verification: {
      databaseRecords: verification.databaseRecords,
      gcsTenantObjects: verification.gcsTenantObjects,
      registeredTenantDomains: verification.registeredTenantDomains,
      activeSessions: verification.activeSessions,
      activeSockets: verification.activeSockets,
      redisKeys: verification.redisKeys,
      operationsJobs: verification.operationsJobs,
    },
  }
}

export const TenantPurgeService = { previewOrganization, purgeOrganization }
