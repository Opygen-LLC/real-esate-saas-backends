import { Model, Types } from 'mongoose'

export interface IWebsiteAsset {
  organizationId: string
  key: string
  url: string
  mimeType: string
  width?: number
  height?: number
  size?: number
  altText?: string
  uploadedBy?: Types.ObjectId | string
  createdAt?: Date
}

export type WebsiteAssetModel = Model<IWebsiteAsset>
