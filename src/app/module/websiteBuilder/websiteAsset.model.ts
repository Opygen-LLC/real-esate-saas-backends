import { Schema, model } from 'mongoose'
import { IWebsiteAsset, WebsiteAssetModel } from './websiteAsset.interface'

const websiteAssetSchema = new Schema<IWebsiteAsset, WebsiteAssetModel>({
  organizationId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  url: { type: String, required: true },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: 'image/jpeg' },
  width: Number,
  height: Number,
  size: Number,
  altText: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'ready', 'rejected'], default: 'pending', index: true },
  etag: { type: String, default: '' },
  scanStatus: { type: String, enum: ['pending', 'clean', 'skipped', 'infected'], default: 'pending' },
  variants: { type: [{ key: String, url: String, format: { type: String, enum: ['webp', 'avif'] }, width: Number, height: Number, size: Number }], default: [] },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  context: { type: String, enum: ['website', 'property-draft', 'property'], default: 'website', index: true },
  uploadSessionId: { type: String, default: '', index: true },
  claimed: { type: Boolean, default: true, index: true },
  claimedByPropertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
  claimedAt: { type: Date, default: null },
  lastReferencedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } })

websiteAssetSchema.index({ organizationId: 1, key: 1 }, { unique: true })
websiteAssetSchema.index({ organizationId: 1, context: 1, uploadSessionId: 1, claimed: 1, createdAt: 1 }, { name: 'property_draft_lifecycle' })
export const WebsiteAsset = model<IWebsiteAsset, WebsiteAssetModel>('WebsiteAsset', websiteAssetSchema)
