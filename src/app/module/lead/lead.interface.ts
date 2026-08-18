import mongoose, { Model } from 'mongoose'
import type { LeadStatus } from './leadStatus.contract'

export type ILeadStatus = LeadStatus
export type ILeadSource = 'Website'|'WhatsApp'|'Facebook'|'Instagram'|'Google'|'Referral'|'WalkIn'|'Portal'|'Phone'|'Email'|'Ad'|'Other'

export interface ILead {
  organizationId:string
  name:string
  email?:string
  normalizedEmail?:string
  phone:string
  normalizedPhone:string
  source:ILeadSource
  budgetMin?:number
  budgetMax?:number
  currency:string
  propertyInterest:Array<mongoose.Types.ObjectId|string>
  locationPreference?:string
  propertyType?:string
  bedrooms?:number
  leadStatus:ILeadStatus
  assignedAgent?:mongoose.Types.ObjectId|string

  /** Canonical audit/ownership fields. Always server controlled. */
  createdBy?:mongoose.Types.ObjectId|string
  updatedBy?:mongoose.Types.ObjectId|string

  /** Canonical follow-up/conversion lifecycle fields. */
  followUpDate?:Date
  convertedAt?:Date
  convertedBy?:mongoose.Types.ObjectId|string
  convertedContactId?:mongoose.Types.ObjectId|string
  isConverted:boolean
  firstContactedAt?:Date

  /**
   * Legacy compatibility fields. Do not use as canonical state for new code.
   * nextFollowUp -> followUpDate
   * contactId -> convertedContactId once conversion migration is complete
   * notes -> Activity/Note timeline in the later history phase
   */
  contactId?:mongoose.Types.ObjectId|string
  lastContact?:Date
  nextFollowUp?:Date
  notes?:string
  lostReason?:string

  leadScore?:number
  scoreReasons?:string[]
  responseDueAt?:Date
  firstResponseAt?:Date
  slaBreachedAt?:Date
  attribution?: { utmSource?:string; utmMedium?:string; utmCampaign?:string; utmTerm?:string; utmContent?:string; referrer?:string; landingPage?:string; firstTouchAt?:Date; lastTouchAt?:Date }
  mergeHistory?: Array<{ mergedAt:Date; duplicateLeadId?:string; source?:string; changedFields?:string[] }>
  createdAt?:Date
  updatedAt?:Date
}

export type ILeadFollowUpPreset = 'scheduled'|'today'|'thisWeek'|'overdue'|'none'

export type ILeadFilter={searchTerm?:string;organizationId?:string;leadStatus?:string;source?:string;assignedAgent?:string;propertyType?:string;minBudget?:number|string;maxBudget?:number|string;sla?:string;minScore?:number|string;scope?:'mine'|'team';isConverted?:boolean|string;followUpPreset?:ILeadFollowUpPreset|string;followUpFrom?:string;followUpTo?:string}
export type LeadModel=Model<ILead>
