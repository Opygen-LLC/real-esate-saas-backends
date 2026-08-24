import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { decryptField, encryptField, maskSensitive } from '../../helpers/fieldEncryption'
import { Billing } from '../billing/billing.model'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { USER_PROFILE_POPULATES, toUserDto } from '../user/userProfile.service'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { AuthSession } from '../auth/authSession.model'
import { OtpChallenge } from '../auth/otpChallenge.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { SuperAdminProfile } from '../superAdminProfile/superAdminProfile.model'
import { ComplianceProfile, DataSubjectRequest } from './compliance.model'
import { PrivacyConsentRecord } from '../privacy/privacyConsent.model'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import mongoose from 'mongoose'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { writeAudit } from '../audit/audit.service'
import { WebsiteSubmission } from '../websiteSubmission/websiteSubmission.model'
import { TENANT_DELETION_COLLECTIONS } from './tenantDataCollections'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { RealtimeService } from '../realtime/realtime.service'
import { ImpersonationSession } from '../platformAdmin/impersonationSession.model'

const sensitiveMap = { nid: 'nidEncrypted', tradeLicense: 'tradeLicenseEncrypted', tin: 'tinEncrypted', bin: 'binEncrypted' } as const

const upsertProfile = async (organizationId: string, payload: Record<string, any>) => {
  const set: Record<string, unknown> = { requiredDocuments: payload.requiredDocuments, verificationStatus: 'pending', submittedAt: new Date() }
  for (const [input, field] of Object.entries(sensitiveMap)) if (payload[input] !== undefined) set[field] = encryptField(payload[input])
  return ComplianceProfile.findOneAndUpdate({ organizationId }, { $set: set }, { upsert: true, new: true })
}

const getProfile = async (organizationId: string, reveal = false) => {
  const profile = await ComplianceProfile.findOne({ organizationId }).select('+nidEncrypted +tradeLicenseEncrypted +tinEncrypted +binEncrypted').lean()
  if (!profile) return { organizationId, requiredDocuments: [], verificationStatus: 'not_submitted', identifiers: {} }
  const identifiers: Record<string, string> = {}
  for (const [label, field] of Object.entries(sensitiveMap)) {
    const encrypted = (profile as any)[field]
    if (encrypted) { const plain = decryptField(encrypted); identifiers[label] = reveal ? plain : maskSensitive(plain) }
    delete (profile as any)[field]
  }
  return { ...profile, identifiers }
}

const recordConsent = (organizationId: string, userId: string, payload: { purpose: 'service_terms' | 'privacy_policy' | 'marketing'; policyVersion: string; granted: boolean }, context: { ip?: string; requestId?: string }) =>
  PrivacyConsentService.record(organizationId, userId, payload, context)

const createRequest = (organizationId: string, requestedBy: string, payload: any) =>
  DataSubjectRequest.create({ organizationId, requestedBy, ...payload })

const listRequests = (organizationId: string) => DataSubjectRequest.find({ organizationId }).sort({ createdAt: -1 })

const exportTenantData = async (organizationId: string) => {
  const [organization, userDocuments, properties, leads, billing, consents, websiteSubmissions] = await Promise.all([
    Organization.findOne({ organizationId }).lean(),
    User.find({ organizationId }).populate(USER_PROFILE_POPULATES),
    Property.find({ organizationId }).lean(), Lead.find({ organizationId }).lean(),
    Billing.find({ organizationId }).lean(), PrivacyConsentRecord.find({ organizationId }).lean(), WebsiteSubmission.find({ organizationId }).lean(),
  ])
  const users = userDocuments.map((user) => toUserDto(user, { includePrivateProfile: true }))
  return { generatedAt: new Date().toISOString(), organization, users, properties, leads, billing, consents, websiteSubmissions,
    exclusions: ['passwords', 'OTP challenges', 'refresh sessions', 'encrypted compliance identifiers', 'platform audit security metadata'] }
}

const downloadExport = async (organizationId: string, id: string) => {
  const request = await DataSubjectRequest.findOne({ _id: id, organizationId, type: 'export', status: 'completed' })
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Completed export request not found')
  return exportTenantData(organizationId)
}

const reviewProfile = async (organizationId: string, status: string, reason: string, actorId: string) => {
  const profile = await ComplianceProfile.findOneAndUpdate({ organizationId }, { verificationStatus: status,
    reviewedAt: new Date(), reviewedBy: actorId, reviewReason: reason }, { new: true })
  if (!profile) throw new ApiError(404, 'Compliance profile not found')
  return profile
}

const processRequest = async (id: string, status: string, reason: string, actorId: string, retentionDays: number) => {
  const request = await DataSubjectRequest.findById(id)
  if (!request) throw new ApiError(404, 'Data request not found')
  if (request.type === 'deletion' && status === 'completed') throw new ApiError(409, 'Deletion is completed only by the retention worker after the reviewed retention period')
  request.status = status as 'in_review' | 'approved' | 'completed' | 'rejected'
  request.operatorReason = reason
  request.processedBy = actorId
  request.processedAt = new Date()
  if (request.type === 'deletion' && status === 'approved') {
    const now = new Date()
    request.retentionUntil = new Date(now.getTime() + retentionDays * 86400000)
    const org: any = await Organization.findOne({ organizationId: request.organizationId })
    if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found for deletion request')

    const explicitAccess = String(org.platformAccess?.status || '')
    const previousAccessStatus = ['active', 'suspended', 'archived'].includes(explicitAccess)
      ? explicitAccess
      : (org.isBlocked ? 'suspended' : 'active')
    const previousSubscriptionStatus = org.subscription?.status === 'suspended'
      ? (org.platformAccess?.previousSubscriptionStatus || (org.subscription?.plan === 'trial' ? 'trialing' : 'active'))
      : (org.subscription?.status || (org.subscription?.plan === 'trial' ? 'trialing' : 'active'))
    const previousWebsiteStatus = org.websiteStatus === 'suspended'
      ? (org.platformAccess?.previousWebsiteStatus || 'published')
      : (org.websiteStatus || 'published')

    org.isBlocked = true
    org.websiteStatus = 'suspended'
    if (org.subscription) org.subscription.status = 'suspended'
    org.platformAccess = {
      ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
      status: 'pending_deletion',
      previousAccessStatus,
      previousSubscriptionStatus,
      previousWebsiteStatus,
      deletionRequestId: String(request._id),
      deletionRequestedAt: now,
      deletionRequestedBy: actorId,
      deletionReason: reason,
      deletionRetentionUntil: request.retentionUntil,
    }
    await org.save()
    await Promise.all([
      AuthSession.updateMany({ organizationId: request.organizationId, revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'tenant_pending_deletion' } }),
      ImpersonationSession.updateMany({ organizationId: request.organizationId, endedAt: null }, { $set: { endedAt: now, endedBy: actorId } }),
      CacheInvalidationService.invalidateTenant(request.organizationId),
    ])
    RealtimeService.emitOrganization(request.organizationId, { type: 'auth.changed', action: 'revoked', entityId: 'organization_pending_deletion', forceLogout: true })
  }
  await request.save()
  return request
}

const executeDueDeletionRequests = async (): Promise<number> => {
  const settings = await PlatformSettings.findOne({ key: 'platform' }).lean()
  if (settings?.privacy?.legalReviewStatus !== 'approved') return 0
  const due = await DataSubjectRequest.find({ type: 'deletion', status: 'approved', retentionUntil: { $lte: new Date() } }).limit(20)
  let completed = 0

  const deleteTenant = async (request: any, session?: mongoose.ClientSession) => {
    const query = User.find({ organizationId: request.organizationId }).select('_id')
    if (session) query.session(session)
    const tenantUsers = await query.lean()
    const userIds = tenantUsers.map((user) => user._id)
    const options = session ? { session } : undefined

    if (userIds.length) {
      await Promise.all([
        AccountCredential.deleteMany({ userId: { $in: userIds } }, options),
        AuthSession.deleteMany({ userId: { $in: userIds } }, options),
        OtpChallenge.deleteMany({ userId: { $in: userIds } }, options),
        UserProfile.deleteMany({ userId: { $in: userIds } }, options),
        AgencyOwnerProfile.deleteMany({ userId: { $in: userIds } }, options),
        AgentProfile.deleteMany({ userId: { $in: userIds } }, options),
        SuperAdminProfile.deleteMany({ userId: { $in: userIds } }, options),
      ])
    }

    for (const name of TENANT_DELETION_COLLECTIONS) {
      await mongoose.connection.collection(name).deleteMany({ organizationId: request.organizationId }, options)
    }
    await Organization.deleteOne({ organizationId: request.organizationId }, options)

    request.status = 'completed'
    request.processedAt = new Date()
    request.operatorReason = `${request.operatorReason} Retention worker completed deletion.`.trim()
    await request.save(session ? { session } : undefined)
    await writeAudit({
      organizationId: request.organizationId,
      actorId: 'retention-worker',
      actorRole: 'system',
      action: 'privacy.deletion_completed',
      entityType: 'dataSubjectRequest',
      entityId: request._id.toString(),
      reason: 'Approved retention period elapsed; tenant operational data deleted.',
      metadata: { collectionPolicyVersion: 2 },
    }, session)
  }

  const transactionsSupported = await mongoSupportsTransactions()
  for (const request of due) {
    if (!transactionsSupported) {
      // Standalone MongoDB cannot provide an all-or-nothing transaction. The
      // request remains idempotent because every delete is scoped by tenant and
      // the request is only marked completed after all operational deletes pass.
      await deleteTenant(request)
      completed += 1
      continue
    }

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => deleteTenant(request, session))
      completed += 1
    } finally {
      await session.endSession()
    }
  }
  return completed
}

export const ComplianceService = { upsertProfile, getProfile, recordConsent, createRequest, listRequests,
  downloadExport, reviewProfile, processRequest, executeDueDeletionRequests }
