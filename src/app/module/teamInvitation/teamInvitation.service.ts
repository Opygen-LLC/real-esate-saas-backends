import crypto from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import sendEmail from '../../helpers/sendEmail'
import hashPassword from '../../helpers/hashPassword'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { TeamInvitation } from './teamInvitation.model'

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const inviteExpiryMs = 48 * 60 * 60 * 1000
const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const createInvitation = async (organizationId: string, invitedBy: string, payload: { name: string; email: string; phoneNumber: string; userRole?: string; specialization?: string[] }) => {
  await EntitlementService.assertLimit(organizationId, 'agents')
  const email = normalizeEmail(payload.email)
  let phoneNumber: string
  try { phoneNumber = normalizeBangladeshPhone(payload.phoneNumber) } catch (error) { throw new ApiError(400, (error as Error).message) }
  if (await User.exists({ email })) throw new ApiError(httpStatus.CONFLICT, 'A user with this email already exists')
  if (await User.exists({ phoneNumber })) throw new ApiError(httpStatus.CONFLICT, 'A user with this phone number already exists')

  await TeamInvitation.updateMany({ organizationId, email, status: 'pending' }, { $set: { status: 'revoked' } })
  const token = crypto.randomBytes(32).toString('base64url')
  const invitation = await TeamInvitation.create({
    organizationId,
    email,
    name: payload.name.trim(),
    phoneNumber,
    userRole: payload.userRole || 'agent',
    specialization: payload.specialization || [],
    tokenHash: tokenHash(token),
    invitedBy,
    expiresAt: new Date(Date.now() + inviteExpiryMs),
  })
  const org = await Organization.findOne({ organizationId }).select('agencyName').lean()
  const agencyName = escapeHtml(String(org?.agencyName || 'an Opygen Real Estate agency'))
  const inviteeName = escapeHtml(payload.name.trim())
  const acceptUrl = `${config.client_url.replace(/\/$/, '')}/invite/accept?token=${encodeURIComponent(token)}`
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
    await invitation.deleteOne()
    throw new ApiError(503, 'The invitation email could not be delivered. Check SMTP configuration and try again.', '', 'EMAIL_DELIVERY_UNAVAILABLE')
  }
  return { invitationId: invitation._id, email: invitation.email, status: invitation.status, expiresAt: invitation.expiresAt }
}

const acceptInvitation = async (token: string, password: string) => {
  const invitation: any = await TeamInvitation.findOne({ tokenHash: tokenHash(token), status: 'pending' })
  if (!invitation) throw new ApiError(404, 'Invitation is invalid, expired, or has already been used')
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    invitation.status = 'expired'; await invitation.save()
    throw new ApiError(410, 'This invitation has expired')
  }
  await EntitlementService.assertLimit(invitation.organizationId, 'agents')
  if (await User.exists({ $or: [{ email: invitation.email }, { phoneNumber: invitation.phoneNumber }] })) throw new ApiError(409, 'This invitation can no longer be accepted because the account already exists')
  const user = await User.create({
    name: invitation.name,
    email: invitation.email,
    phoneNumber: invitation.phoneNumber,
    password: await hashPassword(password),
    organizationId: invitation.organizationId,
    userRole: invitation.userRole,
    specialization: invitation.specialization,
    isVerified: true,
    isAddProfile: true,
    status: 'active',
  })
  invitation.status = 'accepted'; invitation.acceptedAt = new Date(); await invitation.save()
  return { _id: user._id, name: user.name, email: user.email, userRole: user.userRole, organizationId: user.organizationId }
}

const listPending = async (organizationId: string) => TeamInvitation.find({ organizationId, status: 'pending', expiresAt: { $gt: new Date() } }).select('-tokenHash').sort({ createdAt: -1 }).lean()

export const TeamInvitationService = { createInvitation, acceptInvitation, listPending }
