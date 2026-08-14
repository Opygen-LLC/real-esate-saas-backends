import { Schema, model } from 'mongoose'

const teamInvitationSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  name: { type: String, required: true, trim: true },
  phoneNumber: { type: String, required: true, trim: true },
  userRole: { type: String, enum: ['agency_admin', 'agent', 'viewer'], default: 'agent' },
  specialization: { type: [String], default: [] },
  tokenHash: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], default: 'pending', index: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: { type: Date, default: null },
}, { timestamps: true })

teamInvitationSchema.index({ organizationId: 1, email: 1, status: 1 })
export const TeamInvitation = model('TeamInvitation', teamInvitationSchema)
