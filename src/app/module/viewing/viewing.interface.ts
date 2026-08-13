import mongoose, { Model } from 'mongoose'

export type IViewingStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow'
  | 'Rescheduled'

export interface IViewing {
  organizationId: string
  propertyId: mongoose.Types.ObjectId | string
  leadId?: mongoose.Types.ObjectId | string
  agentId: mongoose.Types.ObjectId | string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  status: IViewingStatus
  clientName: string
  clientPhone: string
  clientEmail?: string
  notes?: string
  calendarSyncStatus?: 'not_configured' | 'pending_provider_approval' | 'synced' | 'failed'
  calendarProviderEventId?: string
  feedback?: {
    interestLevel?: 'Very High' | 'Interested' | 'Neutral' | 'Not Interested'
    clientBudgetFeedback?: string
    notes?: string
  calendarSyncStatus?: 'not_configured' | 'pending_provider_approval' | 'synced' | 'failed'
  calendarProviderEventId?: string
  }
  createdAt?: Date
  updatedAt?: Date
}

export type IViewingFilter = {
  searchTerm?: string
  organizationId?: string
  propertyId?: string
  agentId?: string
  leadId?: string
  status?: string
  date?: string
  startDate?: string
  endDate?: string
}

export type ViewingModel = Model<IViewing>
