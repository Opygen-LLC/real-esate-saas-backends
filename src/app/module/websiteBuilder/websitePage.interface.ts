import { Model, Types } from 'mongoose'

export interface IWebsiteSeo {
  canonicalUrl?: string
  title?: string
  description?: string
  openGraph?: { title?: string; description?: string; image?: string }
  robots?: { index?: boolean; follow?: boolean }
  structuredData?: { enabled?: boolean }
}

export interface IWebsitePage {
  organizationId: string
  slug: string
  title: string
  draftDocument: Record<string, any>
  publishedDocument?: Record<string, any>
  status: 'draft' | 'published' | 'scheduled'
  scheduledPublishAt?: Date | null
  accessDeferredAt?: Date | null
  publishedAt?: Date | null
  publishedVersion?: number
  seo?: IWebsiteSeo
  updatedBy?: Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export type WebsitePageModel = Model<IWebsitePage>
