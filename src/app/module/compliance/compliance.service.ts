import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { decryptField, encryptField, maskSensitive } from '../../helpers/fieldEncryption'
import { Billing } from '../billing/billing.model'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { ComplianceProfile, DataSubjectRequest } from './compliance.model'
import { PrivacyConsentRecord } from '../privacy/privacyConsent.model'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import mongoose from 'mongoose'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { writeAudit } from '../audit/audit.service'

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
  const [organization, users, properties, leads, billing, consents] = await Promise.all([
    Organization.findOne({ organizationId }).lean(),
    User.find({ organizationId }).select('-password -verificationCode -codeGenerationTimestamp').lean(),
    Property.find({ organizationId }).lean(), Lead.find({ organizationId }).lean(),
    Billing.find({ organizationId }).lean(), PrivacyConsentRecord.find({ organizationId }).lean(),
  ])
  return { generatedAt: new Date().toISOString(), organization, users, properties, leads, billing, consents,
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
  if (request.type === 'deletion' && ['approved', 'completed'].includes(status)) {
    request.retentionUntil = new Date(Date.now() + retentionDays * 86400000)
    await Organization.updateOne({ organizationId: request.organizationId }, { $set: { isBlocked: true } })
  }
  await request.save()
  return request
}

const executeDueDeletionRequests = async (): Promise<number> => {
  const settings = await PlatformSettings.findOne({ key: 'platform' }).lean()
  if (settings?.privacy?.legalReviewStatus !== 'approved') return 0
  const due = await DataSubjectRequest.find({ type: 'deletion', status: 'approved', retentionUntil: { $lte: new Date() } }).limit(20)
  const tenantCollections = ['users', 'properties', 'leads', 'contacts', 'activities', 'tasks', 'viewings', 'billings',
    'bkashpayments', 'complianceprofiles', 'consentrecords', 'banners', 'sections', 'landingpages', 'websiteassets',
    'websitepages', 'websiterevisions', 'visitorlogs', 'supporttickets']
  let completed = 0
  for (const request of due) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        for (const name of tenantCollections) await mongoose.connection.collection(name).deleteMany({ organizationId: request.organizationId }, { session })
        await Organization.deleteOne({ organizationId: request.organizationId }, { session })
        request.status = 'completed'; request.processedAt = new Date(); request.operatorReason = `${request.operatorReason} Retention worker completed deletion.`.trim()
        await request.save({ session })
        await writeAudit({ organizationId: request.organizationId, actorId: 'retention-worker', actorRole: 'system',
          action: 'privacy.deletion_completed', entityType: 'dataSubjectRequest', entityId: request._id.toString(),
          reason: 'Approved retention period elapsed; tenant operational data deleted.' }, session)
      })
      completed += 1
    } finally { await session.endSession() }
  }
  return completed
}

export const ComplianceService = { upsertProfile, getProfile, recordConsent, createRequest, listRequests,
  downloadExport, reviewProfile, processRequest, executeDueDeletionRequests }
