import { Model, Types } from 'mongoose'

export interface IWebsiteRevision {
  organizationId: string
  pageId: Types.ObjectId | string
  document: Record<string, any>
  schemaVersion: number
  version: number
  createdBy?: Types.ObjectId | string
  message?: string
  restoredFromVersion?: number
  createdAt?: Date
}

export type WebsiteRevisionModel = Model<IWebsiteRevision>
