import { Schema, model } from 'mongoose'

const websiteUploadIntentSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  key: { type: String, required: true, unique: true, index: true },
  objectKeys: { type: [String], default: [] },
  declaredSize: { type: Number, required: true },
  mimeType: { type: String, required: true },
  context: { type: String, enum: ['website', 'property-draft'], default: 'website', index: true },
  uploadSessionId: { type: String, default: '', index: true },
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending', index: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true })

websiteUploadIntentSchema.index({ status: 1, expiresAt: 1 })
websiteUploadIntentSchema.index({ organizationId: 1, context: 1, uploadSessionId: 1, expiresAt: 1 }, { name: 'property_draft_intent_lifecycle' })
export const WebsiteUploadIntent = model('WebsiteUploadIntent', websiteUploadIntentSchema)
