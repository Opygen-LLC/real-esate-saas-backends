import { Model, Types } from 'mongoose'

export interface IWebsiteRevision {
  organizationId: string
  pageId: Types.ObjectId | string
  document: Record<string, any>
  version: number
  createdBy?: Types.ObjectId | string
  message?: string
  createdAt?: Date
}

export type WebsiteRevisionModel = Model<IWebsiteRevision>
