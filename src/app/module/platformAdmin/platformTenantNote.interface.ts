import mongoose, { Document, Model } from 'mongoose'

export type TenantNoteCategory =
  | 'general'
  | 'support'
  | 'billing'
  | 'compliance'
  | 'feature_request'
  | 'operational'

export interface IPlatformTenantNoteAuthor {
  adminId: mongoose.Types.ObjectId | string
  name: string
  email: string
  userRole: string
}

export interface IPlatformTenantNoteEditor {
  adminId: mongoose.Types.ObjectId | string
  name: string
  email: string
  at: Date
}

export interface IPlatformTenantNote {
  organizationId: string
  content: string
  category: TenantNoteCategory
  pinned: boolean
  author: IPlatformTenantNoteAuthor
  isEdited: boolean
  lastEditedBy?: IPlatformTenantNoteEditor | null
  createdAt?: Date
  updatedAt?: Date
}

export interface IPlatformTenantNoteDocument extends IPlatformTenantNote, Document {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export type PlatformTenantNoteModel = Model<IPlatformTenantNoteDocument>
