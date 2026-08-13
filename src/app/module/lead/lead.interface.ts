import mongoose, { Model } from 'mongoose'
export type ILeadStatus = 'New'|'Contacted'|'Qualified'|'ViewingScheduled'|'ViewingCompleted'|'OfferMade'|'Negotiation'|'Won'|'Lost'|string
export type ILeadSource = 'Website'|'WhatsApp'|'Facebook'|'Instagram'|'Google'|'Referral'|'WalkIn'|'Portal'|'Phone'|'Email'|'Ad'|'Other'
export interface ILead {
  organizationId:string; name:string; email?:string; normalizedEmail?:string; phone:string; normalizedPhone:string; source:ILeadSource
  budgetMin?:number; budgetMax?:number; currency:string; propertyInterest:Array<mongoose.Types.ObjectId|string>; locationPreference?:string; propertyType?:string; bedrooms?:number
  leadStatus:ILeadStatus; assignedAgent?:mongoose.Types.ObjectId|string; contactId?:mongoose.Types.ObjectId|string; lastContact?:Date; nextFollowUp?:Date; notes?:string; lostReason?:string
  leadScore?:number; scoreReasons?:string[]; responseDueAt?:Date; firstResponseAt?:Date; slaBreachedAt?:Date
  attribution?: { utmSource?:string; utmMedium?:string; utmCampaign?:string; utmTerm?:string; utmContent?:string; referrer?:string; landingPage?:string; firstTouchAt?:Date; lastTouchAt?:Date }
  mergeHistory?: Array<{ mergedAt:Date; duplicateLeadId?:string; source?:string; changedFields?:string[] }>
  createdAt?:Date; updatedAt?:Date
}
export type ILeadFilter={searchTerm?:string;organizationId?:string;leadStatus?:string;source?:string;assignedAgent?:string;propertyType?:string;minBudget?:number|string;maxBudget?:number|string;sla?:string;minScore?:number|string}
export type LeadModel=Model<ILead>
