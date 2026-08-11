import mongoose, { Model } from 'mongoose'

export type ILeadStatus =
  | 'New'
  | 'Contacted'
  | 'Qualified'
  | 'ViewingScheduled'
  | 'ViewingCompleted'
  | 'OfferMade'
  | 'Negotiation'
  | 'Won'
  | 'Lost'

export type ILeadSource =
  | 'Website'
  | 'WhatsApp'
  | 'Facebook'
  | 'Instagram'
  | 'Google'
  | 'Referral'
  | 'WalkIn'
  | 'Portal'
  | 'Phone'
  | 'Email'
  | 'Ad'
  | 'Other'

export interface ILead {
  organizationId: string
  name: string
  email?: string
  phone: string
  source: ILeadSource
  budgetMin?: number
  budgetMax?: number
  currency: string
  propertyInterest: Array<mongoose.Types.ObjectId | string>
  locationPreference?: string
  propertyType?: string
  bedrooms?: number
  leadStatus: ILeadStatus
  assignedAgent?: mongoose.Types.ObjectId | string
  contactId?: mongoose.Types.ObjectId | string
  lastContact?: Date
  nextFollowUp?: Date
  notes?: string
  lostReason?: string
  createdAt?: Date
  updatedAt?: Date
}

export type ILeadFilter = {
  searchTerm?: string
  organizationId?: string
  leadStatus?: string
  source?: string
  assignedAgent?: string
  propertyType?: string
  minBudget?: number | string
  maxBudget?: number | string
}

export type LeadModel = Model<ILead>
