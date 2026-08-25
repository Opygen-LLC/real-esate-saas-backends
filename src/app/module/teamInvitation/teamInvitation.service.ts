import crypto from 'crypto'
import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import sendEmail from '../../helpers/sendEmail'
import hashPassword from '../../helpers/hashPassword'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { effectivePermissionsForUser, normalizeCustomPermissions, permissionsForRole } from '../user/accessControl'
import { deleteUserCompanionRecords, ensureUserProfile, getUserAccessControl, syncRoleProfile } from '../user/userProfile.service'
import { TeamInvitation } from './teamInvitation.model'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const inviteExpiryMs = 48 * 60 * 60 * 1000
const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

const createInvitation = async (
  organizationId: string,
  invitedBy: string,
  payload: { name: string; email: string; phoneNumber: string; userRole?: string; specialization?: string[]; accessControl?: { useRoleDefaults?: boolean; permissions?: string[] } },
) => {
  const inviter: any = await User.findOne({ _id: invitedBy, organizationId, status: 'active' }).select('_id userRole').lean()
  if (!inviter) throw new ApiError(httpStatus.FORBIDDEN, 'Inviting user is not available')
  const inviterAccess = await getUserAccessControl(inviter._id)
  const requestedRole = payload.userRole || 'agent'
  const requestedPermissions = payload.accessControl?.useRoleDefaults === false
    ? normalizeCustomPermissions(payload.accessControl.permissions || [])
    : permissionsForRole(requestedRole)
  if (inviter.userRole !== 'agency_owner') {
    const inviterPermissions = new Set(effectivePermissionsForUser({ userRole: inviter.userRole, accessControl: inviterAccess }))
    if (requestedPermissions.some((permission) => !inviterPermissions.has(permission))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot grant a role or access level broader than your own')
    }
  }

  const email = normalizeEmail(payload.email)
  let phoneNumber: string
  try { phoneNumber = normalizeBangladeshPhone(payload.phoneNumber) } catch (error) { throw new ApiError(400, (error as Error).message) }
  if (await User.exists({ email })) throw new ApiError(httpStatus.CONFLICT, 'A user with this email already exists')
  if (await User.exists({ phoneNumber })) throw new ApiError(httpStatus.CONFLICT, 'A user with this phone number already exists')

  const prepared = await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    const sessionOptions = session ? { session } : undefined
    const now = new Date()

    // Re-sending/replacing an invitation must consume one reservation, not two.
    await TeamInvitation.updateMany(
      { organizationId, status: 'pending', $or: [{ email }, { phoneNumber }] },
      { $set: { status: 'revoked' } },
      sessionOptions,
    )
    await TeamInvitation.updateMany(
      { organizationId, status: 'pending', expiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
      sessionOptions,
    )

    const emailExists = await withSession(User.exists({ email }), session)
    if (emailExists) throw new ApiError(httpStatus.CONFLICT, 'A user with this email already exists')
    const phoneExists = await withSession(User.exists({ phoneNumber }), session)
    if (phoneExists) throw new ApiError(httpStatus.CONFLICT, 'A user with this phone number already exists')

    await EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1, session })

    const token = crypto.randomBytes(32).toString('base64url')
    const [invitation] = await TeamInvitation.create([{
      organizationId,
      email,
      name: payload.name.trim(),
      phoneNumber,
      userRole: requestedRole,
      specialization: payload.specialization || [],
      accessControl: {
        useRoleDefaults: payload.accessControl?.useRoleDefaults !== false,
        permissions: normalizeCustomPermissions(payload.accessControl?.permissions || []),
      },
      tokenHash: tokenHash(token),
      invitedBy,
      expiresAt: new Date(Date.now() + inviteExpiryMs),
    }], sessionOptions)
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId, session)
    return { invitation, token, quota }
  })

  const org = await Organization.findOne({ organizationId }).select('agencyName').lean()
  const agencyName = escapeHtml(String(org?.agencyName || 'an Opygen Real Estate agency'))
  const inviteeName = escapeHtml(payload.name.trim())
  const acceptUrl = `${config.client_url.replace(/\/$/, '')}/invite/accept?token=${encodeURIComponent(prepared.token)}`
  const delivered = await sendEmail(email, `You're invited to join ${String(org?.agencyName || 'an Opygen Real Estate agency')}`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
      <h2 style="margin-bottom:8px">Join ${agencyName}</h2>
      <p>Hello ${inviteeName},</p>
      <p>You have been invited to join the agency workspace on Opygen Real Estate. This invitation expires in 48 hours.</p>
      <p style="margin:28px 0"><a href="${acceptUrl}" style="background:#18181b;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Accept invitation</a></p>
      <p style="font-size:12px;color:#71717a">If the button does not work, copy this link into your browser:<br>${acceptUrl}</p>
    </div>
  `)
  if (!delivered) {
    await TeamInvitation.updateOne({ _id: prepared.invitation._id, status: 'pending' }, { $set: { status: 'revoked' } })
    throw new ApiError(503, 'The invitation email could not be delivered. Check SMTP configuration and try again.', '', 'EMAIL_DELIVERY_UNAVAILABLE')
  }
  return {
    invitationId: prepared.invitation._id,
    email: prepared.invitation.email,
    status: prepared.invitation.status,
    expiresAt: prepared.invitation.expiresAt,
    quota: prepared.quota,
  }
}

const acceptInvitation = async (token: string, password: string) => {
  const hashedToken = tokenHash(token)
  const preflight: any = await TeamInvitation.findOne({ tokenHash: hashedToken, status: 'pending' }).select('_id organizationId expiresAt').lean()
  if (!preflight) throw new ApiError(404, 'Invitation is invalid, expired, or has already been used')
  await TenantPurgeBarrier.assertTenantWritable(preflight.organizationId)
  if (new Date(preflight.expiresAt).getTime() <= Date.now()) {
    await TeamInvitation.updateOne({ _id: preflight._id, status: 'pending' }, { $set: { status: 'expired' } })
    throw new ApiError(410, 'This invitation has expired')
  }

  const passwordHash = await hashPassword(password)
  return EntitlementService.withTeamMemberQuotaGuard(preflight.organizationId, async (session) => {
    const sessionOptions = session ? { session } : undefined
    const invitation: any = await withSession(
      TeamInvitation.findOne({ tokenHash: hashedToken, status: 'pending', expiresAt: { $gt: new Date() } }),
      session,
    )
    if (!invitation) throw new ApiError(404, 'Invitation is invalid, expired, or has already been used')

    // The pending invitation already reserves this seat, so accepting it has a
    // zero net commitment. If the tenant was downgraded below its committed
    // capacity in the meantime, acceptance is blocked without removing users.
    await EntitlementService.assertTeamMemberCapacity(invitation.organizationId, { additionalCommitments: 0, session })

    const existing = await withSession(User.exists({ $or: [{ email: invitation.email }, { phoneNumber: invitation.phoneNumber }] }), session)
    if (existing) throw new ApiError(409, 'This invitation can no longer be accepted because the account already exists')

    const [user] = await User.create([{
      name: invitation.name,
      email: invitation.email,
      phoneNumber: invitation.phoneNumber,
      organizationId: invitation.organizationId,
      userRole: invitation.userRole,
      isVerified: true,
      status: 'active',
    }], sessionOptions)

    try {
      await AccountCredential.create([{
        userId: user._id,
        passwordHash,
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      }], sessionOptions)
      await ensureUserProfile(user._id, {
        isAddProfile: true,
        accessControl: invitation.accessControl || { useRoleDefaults: true, permissions: [] },
      }, session)
      await syncRoleProfile(user._id, invitation.organizationId, invitation.userRole, {
        specialization: invitation.specialization || [],
      }, session)
    } catch (error) {
      if (!session) {
        await Promise.allSettled([
          AccountCredential.deleteOne({ userId: user._id }),
          deleteUserCompanionRecords(user._id),
          User.deleteOne({ _id: user._id }),
        ])
      }
      throw error
    }

    invitation.status = 'accepted'
    invitation.acceptedAt = new Date()
    await invitation.save(sessionOptions)
    return { _id: user._id, name: user.name, email: user.email, userRole: user.userRole, organizationId: user.organizationId }
  })
}

const listPending = async (organizationId: string) => TeamInvitation.find({ organizationId, status: 'pending', expiresAt: { $gt: new Date() } }).select('-tokenHash').sort({ createdAt: -1 }).lean()

const revokePending = async (organizationId: string, invitationId: string) => {
  const invitation = await TeamInvitation.findOneAndUpdate(
    { _id: invitationId, organizationId, status: 'pending' },
    { $set: { status: 'revoked' } },
    { new: true },
  ).select('-tokenHash').lean()
  if (!invitation) throw new ApiError(httpStatus.NOT_FOUND, 'Pending invitation not found')
  return invitation
}

export const TeamInvitationService = { createInvitation, acceptInvitation, listPending, revokePending }
