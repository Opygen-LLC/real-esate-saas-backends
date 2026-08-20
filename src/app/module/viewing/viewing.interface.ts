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
  viewMode?: 'list' | 'calendar'
}

export type IViewingCalendarFilter = {
  organizationId: string
  startDate: string
  endDate: string
  status?: string
  propertyId?: string
  agentId?: string
}

export type ViewingCalendarItem = {
  _id: string
  date: string
  startTime: string
  endTime: string
  status: IViewingStatus
  clientName: string
  property: { _id: string; title: string; city?: string } | null
  agent: { _id: string; name: string } | null
}

export type ViewingModel = Model<IViewing>
