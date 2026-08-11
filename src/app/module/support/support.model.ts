import mongoose, { Schema, Model } from 'mongoose'

export interface ISupportTicket {
  organizationId: string
  userId?: mongoose.Types.ObjectId | string
  ticketId: string
  subject: string
  category: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  description: string
  messages: Array<{
    sender: 'user' | 'support'
    message: string
    timestamp: Date
  }>
  createdAt?: Date
  updatedAt?: Date
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    ticketId: { type: String, required: true, unique: true },
    subject: { type: String, required: true },
    category: { type: String, default: 'General' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    description: { type: String, required: true },
    messages: {
      type: [
        {
          sender: { type: String, enum: ['user', 'support'] },
          message: String,
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

export const SupportTicket: Model<ISupportTicket> = mongoose.model<ISupportTicket>(
  'SupportTicket',
  supportTicketSchema
)
