import { Schema, model, Types } from 'mongoose'

export interface IAgencyOwnerProfile {
  userId: Types.ObjectId
  organizationId: string
  licenseNumber?: string
  specialization?: string[]
  serviceAreas?: string[]
  createdAt?: Date
  updatedAt?: Date
}

const agencyOwnerProfileSchema = new Schema<IAgencyOwnerProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  organizationId: { type: String, required: true, immutable: true },
  licenseNumber: { type: String, default: '', maxlength: 100 },
  specialization: { type: [String], default: [] },
  serviceAreas: { type: [String], default: [] },
}, { timestamps: true, versionKey: false })

agencyOwnerProfileSchema.index({ userId: 1 }, { unique: true, name: 'agency_owner_profile_user_unique' })
agencyOwnerProfileSchema.index({ organizationId: 1 }, { unique: true, name: 'agency_owner_profile_org_unique' })

export const AgencyOwnerProfile = model<IAgencyOwnerProfile>('AgencyOwnerProfile', agencyOwnerProfileSchema)
