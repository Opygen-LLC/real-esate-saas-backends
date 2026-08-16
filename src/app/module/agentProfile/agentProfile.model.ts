import { Schema, model, Types } from 'mongoose'

export interface IAgentProfile {
  userId: Types.ObjectId
  organizationId: string
  licenseNumber?: string
  specialization?: string[]
  serviceAreas?: string[]
  createdAt?: Date
  updatedAt?: Date
}

const agentProfileSchema = new Schema<IAgentProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  organizationId: { type: String, required: true, index: true, immutable: true },
  licenseNumber: { type: String, default: '', maxlength: 100 },
  specialization: { type: [String], default: [] },
  serviceAreas: { type: [String], default: [] },
}, { timestamps: true, versionKey: false })

agentProfileSchema.index({ userId: 1 }, { unique: true, name: 'agent_profile_user_unique' })
agentProfileSchema.index({ organizationId: 1, licenseNumber: 1 }, { sparse: true, name: 'agent_profile_org_license_lookup' })

export const AgentProfile = model<IAgentProfile>('AgentProfile', agentProfileSchema)
