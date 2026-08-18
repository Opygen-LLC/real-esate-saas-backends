import mongoose, { Model } from 'mongoose'

export type IActivityType =
  | 'call'
  | 'email'
  | 'whatsapp'
  | 'meeting'
  | 'note'
  | 'status_change'
  | 'viewing'
  | 'offer'
  | 'system'

export interface IActivity {
  organizationId: string
  leadId?: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string
  contactId?: mongoose.Types.ObjectId | string
  type: IActivityType
  title: string
  content?: string
  agentId?: mongoose.Types.ObjectId | string
  metadata?: Record<string, any>
  createdAt?: Date
  updatedAt?: Date
}

export type CrmHistoryKind =
  | 'lead_created'
  | 'assignment'
  | 'status_change'
  | 'note'
  | 'call'
  | 'whatsapp'
  | 'email'
  | 'sms'
  | 'meeting'
  | 'follow_up'
  | 'viewing'
  | 'task'
  | 'offer'
  | 'conversion'
  | 'contact'
  | 'system'

export type CrmHistoryAuthor = {
  _id?: string
  name: string
  email?: string
  userRole?: string
  profileImgURL?: string
  type: 'user' | 'system'
}

export type CrmHistoryEntry = {
  _id: string
  kind: CrmHistoryKind
  eventType: string
  title: string
  content: string
  authorId?: string
  author: CrmHistoryAuthor
  leadId?: string
  contactId?: string
  propertyId?: string
  details: Record<string, unknown>
  createdAt: Date
}

export type ActivityModel = Model<IActivity>
