import { Schema, model } from 'mongoose'

const websiteUploadIntentSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  key: { type: String, required: true, unique: true, index: true },
  objectKeys: { type: [String], default: [] },
  declaredSize: { type: Number, required: true },
  mimeType: { type: String, required: true },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending', index: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true })

websiteUploadIntentSchema.index({ status: 1, expiresAt: 1 })
export const WebsiteUploadIntent = model('WebsiteUploadIntent', websiteUploadIntentSchema)
