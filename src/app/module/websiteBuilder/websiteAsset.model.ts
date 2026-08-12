import { Schema, model } from 'mongoose'
import { IWebsiteAsset, WebsiteAssetModel } from './websiteAsset.interface'

const websiteAssetSchema = new Schema<IWebsiteAsset, WebsiteAssetModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      default: 'image/jpeg',
    },
    width: { type: Number },
    height: { type: Number },
    size: { type: Number },
    altText: { type: String, default: '' },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
    },
  }
)

export const WebsiteAsset = model<IWebsiteAsset, WebsiteAssetModel>('WebsiteAsset', websiteAssetSchema)
