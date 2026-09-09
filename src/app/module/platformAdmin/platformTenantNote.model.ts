import mongoose, { Schema } from 'mongoose'
import {
  IPlatformTenantNoteDocument,
  PlatformTenantNoteModel,
} from './platformTenantNote.interface'

const noteAuthorSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    userRole: { type: String, required: true, default: 'super-admin' },
  },
  { _id: false },
)

const noteEditorSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
)

const platformTenantNoteSchema = new Schema<
  IPlatformTenantNoteDocument,
  PlatformTenantNoteModel
>(
  {
    organizationId: { type: String, required: true, trim: true, index: true },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    category: {
      type: String,
      enum: [
        'general',
        'support',
        'billing',
        'compliance',
        'feature_request',
        'operational',
      ],
      default: 'general',
      index: true,
    },
    pinned: { type: Boolean, default: false, index: true },
    author: { type: noteAuthorSchema, required: true },
    isEdited: { type: Boolean, default: false },
    lastEditedBy: { type: noteEditorSchema, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
)

platformTenantNoteSchema.index({ organizationId: 1, pinned: -1, createdAt: -1 })

export const PlatformTenantNote = mongoose.model<
  IPlatformTenantNoteDocument,
  PlatformTenantNoteModel
>('PlatformTenantNote', platformTenantNoteSchema)
