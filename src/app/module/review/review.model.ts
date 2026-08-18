import { Schema, model } from 'mongoose'

const reviewInvitationSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'submitted', 'revoked', 'expired'], default: 'pending', index: true },
  submittedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })
reviewInvitationSchema.index({ organizationId: 1, createdAt: -1 })

const agencyReviewSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  invitationId: { type: Schema.Types.ObjectId, ref: 'ReviewInvitation', required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'published', 'hidden'], default: 'pending', index: true },
  moderatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  moderatedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false })
agencyReviewSchema.index({ organizationId: 1, status: 1, createdAt: -1 })

export const ReviewInvitation = model('ReviewInvitation', reviewInvitationSchema)
export const AgencyReview = model('AgencyReview', agencyReviewSchema)
