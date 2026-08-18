import mongoose, { Model } from 'mongoose'
import type { ILeadSource } from '../lead/lead.interface'
import type { LeadStatus } from '../lead/leadStatus.contract'
import type { ContactRelationshipState } from './contactRelationship.contract'

export type IContactType = 'Buyer' | 'Seller' | 'Tenant' | 'Landlord' | 'Investor' | 'Partner' | 'Other'
export type ContactRelationshipOrigin = 'converted' | 'manual'
export type ContactFollowUpPreset = 'scheduled' | 'today' | 'thisWeek' | 'overdue' | 'none'

export interface IContactLatestInteraction {
  id: string
  type: string
  title: string
  content?: string
  occurredAt: Date
  leadId?: string
  contactId?: string
}

export interface IContact {
  organizationId: string
  name: string
  email?: string
  normalizedEmail?: string
  phone: string
  normalizedPhone?: string
  type: IContactType
  address?: string
  city?: string
  state?: string
  country?: string
  company?: string
  notes?: string
  tags: string[]

  /** CRM relationship fields introduced in Phase 1. */
  relationshipState: ContactRelationshipState
  sourceLeadId?: mongoose.Types.ObjectId | string
  assignedTo?: mongoose.Types.ObjectId | string
  source?: ILeadSource
  propertyInterest?: Array<mongoose.Types.ObjectId | string>
  followUpDate?: Date
  convertedAt?: Date
  convertedBy?: mongoose.Types.ObjectId | string
  createdBy?: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  statusAtConversion?: LeadStatus

  /** Read-only relationship projection populated by the Contact list service. */
  latestInteraction?: IContactLatestInteraction

  createdAt?: Date
  updatedAt?: Date
}

export type IContactFilter = {
  searchTerm?: string
  organizationId?: string
  type?: string
  city?: string
  tag?: string
  assignedTo?: string
  source?: string
  scope?: 'mine' | 'team'
  origin?: ContactRelationshipOrigin
  statusAtConversion?: string
  convertedFrom?: string
  convertedTo?: string
  followUpPreset?: ContactFollowUpPreset
  followUpFrom?: string
  followUpTo?: string
}

export type ContactModel = Model<IContact>
