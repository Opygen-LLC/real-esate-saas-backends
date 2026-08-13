import { Model, Types } from 'mongoose'

export interface IWebsiteAssetVariant {
  key: string
  url: string
  format: 'webp' | 'avif'
  width: number
  height?: number
  size: number
}

export interface IWebsiteAsset {
  organizationId: string
  key: string
  url: string
  originalName?: string
  mimeType: string
  width?: number
  height?: number
  size?: number
  altText?: string
  status?: 'pending' | 'ready' | 'rejected'
  etag?: string
  scanStatus?: 'pending' | 'clean' | 'skipped' | 'infected'
  variants?: IWebsiteAssetVariant[]
  uploadedBy?: Types.ObjectId | string
  lastReferencedAt?: Date
  createdAt?: Date
}

export type WebsiteAssetModel = Model<IWebsiteAsset>
