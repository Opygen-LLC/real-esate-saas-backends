import { Schema, model } from 'mongoose'
import { IWebsiteRevision, WebsiteRevisionModel } from './websiteRevision.interface'

const websiteRevisionSchema = new Schema<IWebsiteRevision, WebsiteRevisionModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    pageId: {
      type: Schema.Types.ObjectId,
      ref: 'WebsitePage',
      required: true,
      index: true,
    },
    document: {
      type: Schema.Types.Mixed,
      required: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    message: {
      type: String,
      default: 'Published version update',
    },
    restoredFromVersion: { type: Number },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
    },
  }
)

websiteRevisionSchema.index({ organizationId: 1, pageId: 1, version: 1 }, { unique: true })

export const WebsiteRevision = model<IWebsiteRevision, WebsiteRevisionModel>(
  'WebsiteRevision',
  websiteRevisionSchema
)
