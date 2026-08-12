import { Model, Types } from 'mongoose'

export interface IWebsitePage {
  organizationId: string
  slug: string
  title: string
  draftDocument: Record<string, any>
  publishedDocument?: Record<string, any>
  status: 'draft' | 'published'
  updatedBy?: Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export type WebsitePageModel = Model<IWebsitePage>
