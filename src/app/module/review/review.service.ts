import crypto from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { AgencyReview, ReviewInvitation } from './review.model'

const hashToken = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

const createInvitation = async (organizationId: string, createdBy: string, propertyId: string, expiresInDays = 30) => {
  const property = await Property.findOne({ _id: propertyId, organizationId }).select('_id title').lean()
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  const token = crypto.randomBytes(32).toString('base64url')
  const invitation = await ReviewInvitation.create({
    organizationId, propertyId, tokenHash: hashToken(token), createdBy,
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
  })
  const url = `${config.client_url.replace(/\/$/, '')}/review/${encodeURIComponent(token)}`
  return { _id: invitation._id, property, status: invitation.status, expiresAt: invitation.expiresAt, url }
}

const list = async (organizationId: string) => {
  const [reviews, invitations] = await Promise.all([
    AgencyReview.find({ organizationId }).populate('propertyId', 'title slug images').sort({ createdAt: -1 }).lean(),
    ReviewInvitation.find({ organizationId }).populate('propertyId', 'title slug').select('-tokenHash').sort({ createdAt: -1 }).limit(100).lean(),
  ])
  return { reviews, invitations }
}

const getInvitation = async (token: string) => {
  const invitation: any = await ReviewInvitation.findOne({ tokenHash: hashToken(token) }).populate('propertyId', 'title slug images').lean()
  if (!invitation || invitation.status !== 'pending') throw new ApiError(httpStatus.NOT_FOUND, 'Review link is invalid or has already been used')
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    await ReviewInvitation.updateOne({ _id: invitation._id }, { $set: { status: 'expired' } })
    throw new ApiError(httpStatus.GONE, 'This review link has expired')
  }
  const organization = await Organization.findOne({ organizationId: invitation.organizationId }).select('agencyName logo').lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Agency not found')
  return { agencyName: organization.agencyName, logo: (organization as any).logo || '', property: invitation.propertyId, expiresAt: invitation.expiresAt }
}

const submit = async (payload: { token: string; name: string; email?: string; phone: string; rating: number; comment: string }) => {
  const tokenHash = hashToken(payload.token)
  const now = new Date()
  // Atomically consume the one-time invitation so two simultaneous submissions cannot create duplicate reviews.
  const invitation: any = await ReviewInvitation.findOneAndUpdate(
    { tokenHash, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'submitted', submittedAt: now } },
    { new: true },
  )
  if (!invitation) {
    const existing: any = await ReviewInvitation.findOne({ tokenHash }).select('status expiresAt')
    if (existing?.status === 'pending' && new Date(existing.expiresAt).getTime() <= now.getTime()) {
      await ReviewInvitation.updateOne({ _id: existing._id, status: 'pending' }, { $set: { status: 'expired' } })
      throw new ApiError(httpStatus.GONE, 'This review link has expired')
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'Review link is invalid or has already been used')
  }

  let phone: string
  try { phone = normalizeBangladeshPhone(payload.phone) } catch (error) {
    await ReviewInvitation.updateOne({ _id: invitation._id, status: 'submitted' }, { $set: { status: 'pending' }, $unset: { submittedAt: 1 } })
    throw new ApiError(httpStatus.BAD_REQUEST, (error as Error).message)
  }
  const email = payload.email?.trim() ? normalizeEmail(payload.email) : ''
  try {
    return await AgencyReview.create({
      organizationId: invitation.organizationId, propertyId: invitation.propertyId, invitationId: invitation._id,
      name: payload.name.trim(), email, phone, rating: payload.rating, comment: payload.comment.trim(), status: 'pending',
    })
  } catch (error) {
    // Release only our still-unfulfilled claim; this keeps transient database failures retryable.
    const reviewExists = await AgencyReview.exists({ invitationId: invitation._id })
    if (!reviewExists) {
      await ReviewInvitation.updateOne({ _id: invitation._id, status: 'submitted' }, { $set: { status: 'pending' }, $unset: { submittedAt: 1 } })
    }
    throw error
  }
}

const moderate = async (organizationId: string, id: string, status: 'pending' | 'published' | 'hidden', actorId: string) => {
  const review = await AgencyReview.findOneAndUpdate({ _id: id, organizationId }, { $set: { status, moderatedBy: actorId, moderatedAt: new Date() } }, { new: true, runValidators: true })
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found')
  return review
}

const remove = async (organizationId: string, id: string) => {
  const review = await AgencyReview.findOneAndDelete({ _id: id, organizationId })
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found')
  return review
}

const revokeInvitation = async (organizationId: string, id: string) => {
  const invitation = await ReviewInvitation.findOneAndUpdate({ _id: id, organizationId, status: 'pending' }, { $set: { status: 'revoked' } }, { new: true })
  if (!invitation) throw new ApiError(httpStatus.NOT_FOUND, 'Pending review invitation not found')
  return invitation
}

const getPublicReviews = async (organizationId: string) => AgencyReview.find({ organizationId, status: 'published' })
  .populate('propertyId', 'title slug images').select('name rating comment propertyId createdAt').sort({ createdAt: -1 }).limit(50).lean()

export const ReviewService = { createInvitation, list, getInvitation, submit, moderate, remove, revokeInvitation, getPublicReviews }
