import { Schema, model } from 'mongoose'
import { IWebsitePage, WebsitePageModel } from './websitePage.interface'

const websitePageSchema = new Schema<IWebsitePage, WebsitePageModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      default: '/',
    },
    title: {
      type: String,
      required: true,
      default: 'Home',
    },
    draftDocument: {
      type: Schema.Types.Mixed,
      required: true,
    },
    publishedDocument: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

// Compound index for unique page slug per organization
websitePageSchema.index({ organizationId: 1, slug: 1 }, { unique: true })

export const WebsitePage = model<IWebsitePage, WebsitePageModel>('WebsitePage', websitePageSchema)
