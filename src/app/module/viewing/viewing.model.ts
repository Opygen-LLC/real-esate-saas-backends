import { Schema, model } from 'mongoose'
import { IViewing, ViewingModel } from './viewing.interface'

const viewingSchema = new Schema<IViewing, ViewingModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Rescheduled'],
      default: 'Scheduled',
      required: true,
    },
    clientName: {
      type: String,
      required: true,
      trim: true,
    },
    clientPhone: {
      type: String,
      required: true,
      trim: true,
    },
    clientEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    notes: { type: String, default: '' },
    calendarSyncStatus: { type: String, enum: ['not_configured','pending_provider_approval','synced','failed'], default: 'not_configured' },
    calendarProviderEventId: { type: String, default: '' },
    feedback: {
      interestLevel: {
        type: String,
        enum: ['Very High', 'Interested', 'Neutral', 'Not Interested'],
      },
      clientBudgetFeedback: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
  },
  {
    timestamps: true,
  }
)

viewingSchema.index({ organizationId: 1, date: 1, startTime: 1 })
viewingSchema.index({ organizationId: 1, agentId: 1, date: 1 })
viewingSchema.index({ organizationId: 1, date: 1, status: 1, agentId: 1, startTime: 1, endTime: 1 }, { name: 'viewing_tenant_date_status_agent_window' })
viewingSchema.index({ organizationId: 1, date: 1, status: 1, propertyId: 1, startTime: 1, endTime: 1 }, { name: 'viewing_tenant_date_status_property_window' })
viewingSchema.index({ organizationId: 1, status: 1 })
viewingSchema.index({ organizationId: 1, status: 1, date: 1 })
viewingSchema.index({ organizationId: 1, agentId: 1, createdAt: -1 })

export const Viewing = model<IViewing, ViewingModel>('Viewing', viewingSchema)
