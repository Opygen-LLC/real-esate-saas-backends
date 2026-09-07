import { Schema, model } from 'mongoose'
import type { StudioSnapshot, StudioBuilderPage } from '../../../contracts/websiteCatalog/studio'

export interface IWebsiteStudio {
  organizationId: string
  schemaVersion: number
  draftRevision: number
  basePublicationRevision: number
  publishedDraftRevision: number | null
  snapshot: StudioSnapshot
  // The published builder documents are frozen, not mutable builder drafts.
  builderPages: StudioBuilderPage[]
  updatedBy?: string
  updatedAt?: Date
  createdAt?: Date
}
const schema = new Schema<IWebsiteStudio>({
  organizationId: { type: String, required: true, unique: true },
  schemaVersion: { type: Number, required: true, default: 1 },
  draftRevision: { type: Number, required: true, min: 0, default: 0 },
  basePublicationRevision: { type: Number, required: true, min: 0 },
  publishedDraftRevision: { type: Number, default: null },
  snapshot: { type: Schema.Types.Mixed, required: true },
  builderPages: { type: [Schema.Types.Mixed] as any, default: [] },
  updatedBy: String,
}, { timestamps: true, minimize: false })
export const WebsiteStudio = model<IWebsiteStudio>('WebsiteStudio', schema)

export interface IWebsiteStudioRevision {
  organizationId: string
  revision: number
  snapshot: StudioSnapshot
  builderPages: StudioBuilderPage[]
  publishedAt: Date
  createdBy?: string
  message: string
}
const revisionSchema = new Schema<IWebsiteStudioRevision>({
  organizationId: { type: String, required: true },
  revision: { type: Number, required: true, min: 0 },
  snapshot: { type: Schema.Types.Mixed, required: true },
  builderPages: { type: [Schema.Types.Mixed] as any, default: [] },
  publishedAt: { type: Date, required: true },
  createdBy: String,
  message: { type: String, maxlength: 300, default: 'Website published' },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false })
revisionSchema.index({ organizationId: 1, revision: -1 }, { unique: true, name: 'studio_revision_per_tenant' })
export const WebsiteStudioRevision = model<IWebsiteStudioRevision>('WebsiteStudioRevision', revisionSchema)

// Durable receipts make a timed-out save/publish safe to retry with the same key.
const receiptSchema = new Schema({
  organizationId: { type: String, required: true },
  mutationId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  result: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })
receiptSchema.index({ organizationId: 1, mutationId: 1 }, { unique: true, name: 'studio_mutation_receipt' })
receiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const WebsiteStudioReceipt = model('WebsiteStudioReceipt', receiptSchema)
