import { Schema, model, type Model, type Types } from 'mongoose'
import { PROPERTY_DOCUMENT_TYPES, type PropertyDocumentType } from './property.constants'

export interface IPropertyDocumentAsset {
  organizationId: string
  uploadSessionId: string
  key: string
  category: PropertyDocumentType
  originalName: string
  mimeType: string
  declaredSize: number
  size: number
  status: 'pending' | 'ready' | 'rejected'
  scanStatus: 'pending' | 'clean' | 'skipped' | 'infected'
  uploadedBy?: Types.ObjectId | string
  claimed: boolean
  claimedByPropertyId?: Types.ObjectId | string | null
  claimedAt?: Date | null
  lastReferencedAt: Date
  createdAt?: Date
}

export type PropertyDocumentAssetModel = Model<IPropertyDocumentAsset>

const propertyDocumentAssetSchema = new Schema<IPropertyDocumentAsset, PropertyDocumentAssetModel>({
  organizationId: { type: String, required: true, index: true },
  uploadSessionId: { type: String, required: true, index: true },
  key: { type: String, required: true, unique: true },
  category: { type: String, enum: PROPERTY_DOCUMENT_TYPES, required: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  mimeType: { type: String, required: true },
  declaredSize: { type: Number, required: true, min: 1 },
  size: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['pending', 'ready', 'rejected'], default: 'pending', index: true },
  scanStatus: { type: String, enum: ['pending', 'clean', 'skipped', 'infected'], default: 'pending' },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  claimed: { type: Boolean, default: false, index: true },
  claimedByPropertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
  claimedAt: { type: Date, default: null },
  lastReferencedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

propertyDocumentAssetSchema.index({ organizationId: 1, uploadSessionId: 1, claimed: 1, lastReferencedAt: 1 }, { name: 'property_document_draft_lifecycle' })

export const PropertyDocumentAsset = model<IPropertyDocumentAsset, PropertyDocumentAssetModel>('PropertyDocumentAsset', propertyDocumentAssetSchema)
