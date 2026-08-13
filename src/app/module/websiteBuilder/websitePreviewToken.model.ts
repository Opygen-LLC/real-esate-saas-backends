import { Schema, model } from 'mongoose'

const websitePreviewTokenSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  pageId: { type: Schema.Types.ObjectId, ref: 'WebsitePage', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } })

export const WebsitePreviewToken = model('WebsitePreviewToken', websitePreviewTokenSchema)
