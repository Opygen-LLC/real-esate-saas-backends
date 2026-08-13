import mongoose, { Schema, Model } from 'mongoose'

export type SupportPriority = 'low' | 'medium' | 'high' | 'urgent'
export type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface ISupportTicket {
  organizationId: string
  organizationName?: string
  userId?: mongoose.Types.ObjectId | string
  ownerId?: mongoose.Types.ObjectId | string
  ticketId: string
  subject: string
  category: string
  priority: SupportPriority
  status: SupportStatus
  description: string
  firstResponseDueAt: Date
  resolutionDueAt: Date
  firstRespondedAt?: Date | null
  resolvedAt?: Date | null
  slaBreachedAt?: Date | null
  lastCustomerNotifiedAt?: Date | null
  messages: Array<{ sender: 'user' | 'support'; authorId?: string; message: string; timestamp: Date }>
  internalNotes: Array<{ authorId: string; note: string; timestamp: Date }>
  attachments: Array<{
    _id?: mongoose.Types.ObjectId
    key: string
    url: string
    originalName: string
    mimeType: string
    declaredSize: number
    size: number
    visibility: 'customer' | 'internal'
    status: 'pending' | 'ready' | 'rejected'
    scanStatus: 'pending' | 'clean' | 'skipped' | 'infected'
    uploadedBy: string
    createdAt: Date
  }>
  createdAt?: Date
  updatedAt?: Date
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    organizationId: { type: String, required: true, index: true },
    organizationName: { type: String, default: '', maxlength: 160 },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ticketId: { type: String, required: true, unique: true },
    subject: { type: String, required: true, maxlength: 200 },
    category: { type: String, default: 'General', maxlength: 80 },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', index: true },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open', index: true },
    description: { type: String, required: true, maxlength: 5000 },
    firstResponseDueAt: { type: Date, required: true, index: true },
    resolutionDueAt: { type: Date, required: true, index: true },
    firstRespondedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    slaBreachedAt: { type: Date, default: null, index: true },
    lastCustomerNotifiedAt: { type: Date, default: null },
    messages: { type: [{ sender: { type: String, enum: ['user', 'support'] }, authorId: { type: String, default: '' }, message: { type: String, maxlength: 5000 }, timestamp: { type: Date, default: Date.now } }], default: [] },
    internalNotes: { type: [{ authorId: { type: String, required: true }, note: { type: String, maxlength: 5000 }, timestamp: { type: Date, default: Date.now } }], default: [] },
    attachments: { type: [{
      key: { type: String, required: true }, url: { type: String, required: true }, originalName: { type: String, required: true, maxlength: 255 },
      mimeType: { type: String, required: true }, declaredSize: { type: Number, required: true, min: 1 }, size: { type: Number, default: 0 },
      visibility: { type: String, enum: ['customer', 'internal'], default: 'customer' }, status: { type: String, enum: ['pending', 'ready', 'rejected'], default: 'pending' },
      scanStatus: { type: String, enum: ['pending', 'clean', 'skipped', 'infected'], default: 'pending' }, uploadedBy: { type: String, required: true }, createdAt: { type: Date, default: Date.now },
    }], default: [] },
  },
  { timestamps: true },
)

supportTicketSchema.index({ organizationId: 1, createdAt: -1 })
supportTicketSchema.index({ status: 1, priority: 1, firstResponseDueAt: 1 })
supportTicketSchema.index({ ownerId: 1, status: 1, updatedAt: -1 })

export const SupportTicket: Model<ISupportTicket> = mongoose.model<ISupportTicket>('SupportTicket', supportTicketSchema)
