import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { decryptField, encryptField, maskSensitive } from '../../helpers/fieldEncryption'
import { Billing } from '../billing/billing.model'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { USER_PROFILE_POPULATES, toUserDto } from '../user/userProfile.service'
import { ComplianceProfile, DataSubjectRequest } from './compliance.model'
import { PrivacyConsentRecord } from '../privacy/privacyConsent.model'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { WebsiteSubmission } from '../websiteSubmission/websiteSubmission.model'

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

const processRequest = async (id: string, status: string, reason: string, actorId: string) => {
  const request = await DataSubjectRequest.findById(id)
  if (!request) throw new ApiError(404, 'Data request not found')

  // Tenant deletion is no longer scheduled or executed by the compliance
  // request workflow. Super Admin permanent deletion has one canonical,
  // immediate endpoint backed by TenantPurgeService.
  if (request.type === 'deletion' && ['approved', 'completed'].includes(status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Use the Super Admin organization hard-delete action to permanently delete this tenant; retention scheduling is no longer supported')
  }

  request.status = status as 'in_review' | 'approved' | 'completed' | 'rejected'
  request.operatorReason = reason
  request.processedBy = actorId
  request.processedAt = new Date()
  request.retentionUntil = null
  await request.save()
  return request
}

export const ComplianceService = { upsertProfile, getProfile, recordConsent, createRequest, listRequests,
  downloadExport, reviewProfile, processRequest }
