import { Model, Types } from 'mongoose'

export type WebsiteAssetContext = 'website' | 'property-draft' | 'property'

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
  context?: WebsiteAssetContext
  uploadSessionId?: string
  claimed?: boolean
  claimedByPropertyId?: Types.ObjectId | string
  claimedAt?: Date
  lastReferencedAt?: Date
  createdAt?: Date
}

export type WebsiteAssetModel = Model<IWebsiteAsset>
