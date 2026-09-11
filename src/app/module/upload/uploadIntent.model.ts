import { Schema, model } from 'mongoose'

const uploadIntentSchema = new Schema({
  uploadId: { type: String, required: true, unique: true, index: true },
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, default: '', index: true },
  // key is always the durable public object key. uploadKey is a private R2
  // staging key for Phase 4 uploads; older Phase 3 intents may not have it.
  key: { type: String, required: true, unique: true, index: true },
  uploadKey: { type: String, default: '', index: true },
  folder: { type: String, enum: ['general', 'avatar', 'branding', 'website', 'property'], required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], required: true },
  finalMimeType: { type: String, enum: ['', 'image/webp'], default: '' },
  declaredSize: { type: Number, required: true },
  actualSize: { type: Number, default: 0 },
  finalSize: { type: Number, default: 0 },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  publicUrl: { type: String, default: '' },
  etag: { type: String, default: '' },
  // pending/completing/completed are retained only so in-flight Phase 3
  // intents survive a rolling deployment. New uploads use the Phase 4 states.
  status: {
    type: String,
    enum: ['pending', 'completing', 'completed', 'presigned', 'uploaded', 'verifying', 'processing', 'ready', 'rejected'],
    default: 'presigned',
    index: true,
  },
  completionStartedAt: { type: Date, default: null },
  uploadedAt: { type: Date, default: null },
  processingStartedAt: { type: Date, default: null },
  processedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  processingAttempts: { type: Number, default: 0 },
  nextProcessingAt: { type: Date, default: null, index: true },
  lastProcessingError: { type: String, default: '' },
  failureCode: { type: String, default: '' },
  failureMessage: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true })

uploadIntentSchema.index({ organizationId: 1, userId: 1, status: 1, expiresAt: 1 })
uploadIntentSchema.index({ organizationId: 1, createdAt: -1 })
uploadIntentSchema.index({ status: 1, nextProcessingAt: 1, processingStartedAt: 1 }, { name: 'direct_image_processing_queue' })

export const UploadIntent = model('UploadIntent', uploadIntentSchema)
