import { Schema, model } from 'mongoose'
import { IWebsitePage, WebsitePageModel } from './websitePage.interface'

const websitePageSchema = new Schema<IWebsitePage, WebsitePageModel>({
  organizationId: { type: String, required: true, index: true },
  slug: { type: String, required: true, default: '/' },
  title: { type: String, required: true, default: 'Home' },
  draftDocument: { type: Schema.Types.Mixed, required: true },
  publishedDocument: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['draft', 'published', 'scheduled'], default: 'draft', index: true },
  scheduledPublishAt: { type: Date, default: null, index: true },
  publishedAt: { type: Date, default: null },
  publishedVersion: { type: Number, default: 0 },
  seo: { type: Schema.Types.Mixed, default: {} },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { virtuals: true } })

websitePageSchema.index({ organizationId: 1, slug: 1 }, { unique: true })
websitePageSchema.index({ status: 1, scheduledPublishAt: 1 })
export const WebsitePage = model<IWebsitePage, WebsitePageModel>('WebsitePage', websitePageSchema)
