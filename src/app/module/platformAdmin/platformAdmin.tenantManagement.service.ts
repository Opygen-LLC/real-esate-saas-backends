import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { writeAudit } from '../audit/audit.service'
import { AuthSession } from '../auth/authSession.model'
import { AuthServices } from '../auth/auth.services'
import { TenantPurgeService } from '../compliance/tenantPurge.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import type { SubscriptionStatus } from '../organization/organization.interface'
import { RealtimeService } from '../realtime/realtime.service'
import { User } from '../user/user.model'
import { ImpersonationSession } from './impersonationSession.model'

export interface PlatformAdminActor {
  id: string
  reason: string
  requestId?: string
  ip?: string
  userAgent?: string
}

type AccessLifecycle = 'active' | 'suspended' | 'archived' | 'pending_deletion'

const lifecycleStatus = (org: any): AccessLifecycle => {
  const explicit = String(org.platformAccess?.status || '')
  if (['active', 'suspended', 'archived', 'pending_deletion'].includes(explicit)) return explicit as AccessLifecycle
  return org.isBlocked ? 'suspended' : 'active'
}

const restoreSubscriptionStatus = (org: any, candidate?: SubscriptionStatus | null): SubscriptionStatus => {
  const fallback: SubscriptionStatus = org.subscription?.plan === 'trial' ? 'trialing' : 'active'
  let restored: SubscriptionStatus = candidate && candidate !== 'suspended' ? candidate : fallback
  const now = new Date()
  const periodEnd = org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd) : null
  const graceEnd = org.subscription?.gracePeriodEnd ? new Date(org.subscription.gracePeriodEnd) : null
  if (periodEnd && periodEnd.getTime() <= now.getTime()) {
    restored = graceEnd && graceEnd.getTime() > now.getTime() ? 'grace' : 'expired'
  }
  return restored
}

const ownerForOrganization = async (org: any) => {
  let owner: any = null
  if (org.ownerId) owner = await User.findOne({ _id: org.ownerId, organizationId: org.organizationId })
  if (!owner) owner = await User.findOne({ organizationId: org.organizationId, userRole: 'agency_owner' }).sort({ createdAt: 1, _id: 1 })
  if (!owner) throw new ApiError(httpStatus.NOT_FOUND, 'Agency owner not found')
  if (owner.userRole !== 'agency_owner') throw new ApiError(httpStatus.CONFLICT, 'Canonical owner record is not an agency owner')
  if (!org.ownerId || String(org.ownerId) !== String(owner._id)) {
    await Organization.updateOne({ _id: org._id }, { $set: { ownerId: owner._id } })
  }
  return owner
}

const updateTenantProfile = async (organizationId: string, payload: any, actor: PlatformAdminActor) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (lifecycleStatus(org) === 'pending_deletion') throw new ApiError(httpStatus.CONFLICT, 'Agency is pending permanent deletion and can no longer be edited')

  const changedFields: string[] = []
  const assign = (field: string, value: unknown) => {
    if (value === undefined) return
    const normalized = typeof value === 'string' ? value.trim() : value
    if (JSON.stringify(org.get(field)) !== JSON.stringify(normalized)) {
      org.set(field, normalized)
      changedFields.push(field)
    }
  }

  assign('agencyName', payload.agencyName)
  assign('agencyType', payload.agencyType)
  assign('email', payload.businessEmail)
  assign('phone', payload.businessPhone)
  assign('licenseNumber', payload.licenseNumber)
  assign('address', payload.address)
  assign('city', payload.city)
  assign('state', payload.state)
  assign('country', payload.country)
  assign('zipCode', payload.zipCode)
  assign('defaultLanguage', payload.defaultLanguage)
  if (payload.addressDetails !== undefined) assign('addressDetails', { ...(org.addressDetails?.toObject?.() || org.addressDetails || {}), ...payload.addressDetails })
  if (payload.operationalSettings !== undefined) assign('teamSettings', { ...(org.teamSettings?.toObject?.() || org.teamSettings || {}), ...payload.operationalSettings })

  if (!changedFields.length) throw new ApiError(httpStatus.BAD_REQUEST, 'No agency profile changes were provided')
  await org.save()
  await CacheInvalidationService.invalidateTenant(organizationId)
  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'super-admin',
    action: 'organization.profile_updated',
    entityType: 'organization',
    entityId: org._id.toString(),
    reason: actor.reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: { changedFields },
  })
  RealtimeService.emitOrganization(organizationId, { type: 'organization.changed', action: 'updated', entityId: String(org._id), eventType: 'organization.profile_updated' })
  return org
}

const updateTenantOwner = async (organizationId: string, payload: any, actor: PlatformAdminActor) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (lifecycleStatus(org) === 'pending_deletion') throw new ApiError(httpStatus.CONFLICT, 'Agency is pending permanent deletion and can no longer be edited')

  const owner: any = await ownerForOrganization(org)
  const changedFields: string[] = []
  const email = payload.email !== undefined ? normalizeEmail(String(payload.email)) : owner.email
  let phoneNumber = owner.phoneNumber
  if (payload.phoneNumber !== undefined) {
    try { phoneNumber = normalizeBangladeshPhone(String(payload.phoneNumber)) }
    catch (error) { throw new ApiError(httpStatus.BAD_REQUEST, (error as Error).message) }
  }
  const emailChanged = email !== owner.email
  const phoneChanged = phoneNumber !== owner.phoneNumber

  if (emailChanged && owner.status === 'blocked') {
    throw new ApiError(httpStatus.CONFLICT, 'Reactivate the agency owner account before changing its login email')
  }

  if (emailChanged) {
    const existingEmail = await User.exists({ _id: { $ne: owner._id }, email })
    if (existingEmail) throw new ApiError(httpStatus.CONFLICT, 'This login email is already used by another account')
  }
  if (phoneChanged) {
    const existingPhone = await User.exists({ _id: { $ne: owner._id }, phoneNumber })
    if (existingPhone) throw new ApiError(httpStatus.CONFLICT, 'This phone number is already used by another account')
  }

  if (payload.name !== undefined && String(payload.name).trim() !== owner.name) {
    owner.name = String(payload.name).trim()
    changedFields.push('name')
  }
  if (emailChanged) {
    owner.email = email
    owner.isVerified = false
    owner.status = 'pending'
    changedFields.push('email')
  }
  if (phoneChanged) {
    owner.phoneNumber = phoneNumber
    changedFields.push('phoneNumber')
  }
  if (!changedFields.length) throw new ApiError(httpStatus.BAD_REQUEST, 'No owner identity changes were provided')

  await owner.save()

  let verificationEmailSent = false
  if (emailChanged) {
    const now = new Date()
    await Promise.all([
      AccountCredential.updateOne({ userId: owner._id }, { $set: { emailVerifiedAt: null } }),
      AuthSession.updateMany({ userId: owner._id, revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'owner_email_changed_by_platform_admin' } }),
    ])
    RealtimeService.emitAuthorizationChanged({ userId: owner._id.toString(), organizationId, forceLogout: true, reason: 'owner_email_changed' })
    RealtimeService.emitSessionChanged({ userId: owner._id.toString(), organizationId, forceLogout: true, reason: 'owner_email_changed' })
    await RealtimeService.disconnectUser(owner._id.toString())
    try {
      await AuthServices.resendOtp(email, { requestId: actor.requestId, ip: actor.ip, userAgent: actor.userAgent })
      verificationEmailSent = true
    } catch {
      // The identity change is still valid and the owner can use the existing
      // public resend-OTP endpoint. Surface this state to Super Admin explicitly.
      verificationEmailSent = false
    }
  }

  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'super-admin',
    action: 'organization.owner_identity_updated',
    entityType: 'user',
    entityId: owner._id.toString(),
    reason: actor.reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: { changedFields, emailChanged, phoneChanged, emailReverificationRequired: emailChanged },
  })
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'updated', entityId: owner._id.toString(), eventType: 'organization.owner_identity_updated' })

  return {
    owner: {
      _id: owner._id,
      name: owner.name,
      email: owner.email,
      phoneNumber: owner.phoneNumber,
      userRole: owner.userRole,
      status: owner.status,
      isVerified: owner.isVerified,
    },
    emailChanged,
    verificationEmailSent,
  }
}

const archiveTenant = async (organizationId: string, actor: PlatformAdminActor) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const currentAccess = lifecycleStatus(org)
  if (currentAccess === 'archived') throw new ApiError(httpStatus.CONFLICT, 'Organization is already archived')
  if (currentAccess === 'pending_deletion') throw new ApiError(httpStatus.CONFLICT, 'Organization is already pending permanent deletion')

  const previousSubscriptionStatus = org.subscription?.status === 'suspended'
    ? (org.platformAccess?.previousSubscriptionStatus || (org.subscription?.plan === 'trial' ? 'trialing' : 'active'))
    : (org.subscription?.status || (org.subscription?.plan === 'trial' ? 'trialing' : 'active'))
  const previousWebsiteStatus = org.websiteStatus === 'suspended'
    ? (org.platformAccess?.previousWebsiteStatus || 'published')
    : (org.websiteStatus || 'published')
  const now = new Date()

  org.isBlocked = true
  org.websiteStatus = 'suspended'
  if (org.subscription) org.subscription.status = 'suspended'
  org.platformAccess = {
    ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
    status: 'archived',
    previousAccessStatus: currentAccess,
    previousSubscriptionStatus,
    previousWebsiteStatus,
    archivedAt: now,
    archivedBy: actor.id,
    archiveReason: actor.reason,
  }
  await org.save()
  await Promise.all([
    AuthSession.updateMany({ organizationId, revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'tenant_archived' } }),
    ImpersonationSession.updateMany({ organizationId, endedAt: null }, { $set: { endedAt: now, endedBy: actor.id } }),
    CacheInvalidationService.invalidateTenant(organizationId),
  ])
  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'super-admin',
    action: 'organization.archived',
    entityType: 'organization',
    entityId: org._id.toString(),
    reason: actor.reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: { previousAccessStatus: currentAccess, previousSubscriptionStatus, previousWebsiteStatus },
  })
  RealtimeService.emitOrganization(organizationId, { type: 'auth.changed', action: 'revoked', entityId: 'organization_archived', forceLogout: true })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: 'tenant_archived' })
  return org
}

const restoreArchivedTenant = async (organizationId: string, actor: PlatformAdminActor) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (lifecycleStatus(org) !== 'archived') throw new ApiError(httpStatus.CONFLICT, 'Only archived organizations can be restored with this action')

  const previousAccess = org.platformAccess?.previousAccessStatus === 'suspended' ? 'suspended' : 'active'
  const restoredSubscription = restoreSubscriptionStatus(org, org.platformAccess?.previousSubscriptionStatus)
  const restoredWebsite = org.platformAccess?.previousWebsiteStatus && org.platformAccess.previousWebsiteStatus !== 'suspended'
    ? org.platformAccess.previousWebsiteStatus
    : 'published'

  org.isBlocked = previousAccess === 'suspended'
  org.websiteStatus = previousAccess === 'suspended' ? 'suspended' : restoredWebsite
  if (org.subscription) org.subscription.status = previousAccess === 'suspended' ? 'suspended' : restoredSubscription
  org.platformAccess = {
    ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
    status: previousAccess,
    restoredAt: new Date(),
    restoredBy: actor.id,
    restoreReason: actor.reason,
  }
  await org.save()
  await CacheInvalidationService.invalidateTenant(organizationId)
  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'super-admin',
    action: 'organization.archive_restored',
    entityType: 'organization',
    entityId: org._id.toString(),
    reason: actor.reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: { restoredAccessStatus: previousAccess, restoredSubscriptionStatus: org.subscription?.status, restoredWebsiteStatus: org.websiteStatus },
  })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: 'tenant_archive_restored' })
  return org
}

const getDeletionPreview = async (organizationId: string) => TenantPurgeService.previewOrganization(organizationId)

const hardDeleteTenant = async (organizationId: string, payload: { organizationId: string; confirmationText: string }, actor: PlatformAdminActor) => {
  const routeOrganizationId = String(organizationId || '').trim()
  const confirmedOrganizationId = String(payload.organizationId || '').trim()
  const confirmationText = String(payload.confirmationText || '').trim()

  if (confirmedOrganizationId !== routeOrganizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID confirmation does not match the organization being deleted')
  }
  if (confirmationText !== 'DELETE PERMANENTLY') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Confirmation text must exactly match DELETE PERMANENTLY')
  }

  const org: any = await Organization.findOne({ organizationId: routeOrganizationId }).select('_id organizationId').lean()
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (String(org.organizationId) !== confirmedOrganizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID confirmation does not match the stored organization')
  }

  return TenantPurgeService.purgeOrganization(routeOrganizationId, {
    id: actor.id,
    reason: 'Super Admin permanent organization deletion',
  })
}

export const PlatformAdminTenantManagementService = {
  updateTenantProfile,
  updateTenantOwner,
  archiveTenant,
  restoreArchivedTenant,
  getDeletionPreview,
  hardDeleteTenant,
}
