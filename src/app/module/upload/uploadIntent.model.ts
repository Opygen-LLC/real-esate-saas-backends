import { Schema, model } from 'mongoose'

const uploadIntentSchema = new Schema({
  uploadId: { type: String, required: true, unique: true, index: true },
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, default: '', index: true },
  key: { type: String, required: true, unique: true, index: true },
  folder: { type: String, enum: ['general', 'avatar', 'branding', 'website', 'property'], required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  declaredSize: { type: Number, required: true },
  actualSize: { type: Number, default: 0 },
  publicUrl: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'completing', 'completed', 'rejected'], default: 'pending', index: true },
  completionStartedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true })

uploadIntentSchema.index({ organizationId: 1, userId: 1, status: 1, expiresAt: 1 })
uploadIntentSchema.index({ organizationId: 1, createdAt: -1 })

export const UploadIntent = model('UploadIntent', uploadIntentSchema)
