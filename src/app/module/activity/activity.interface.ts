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

export type ActivityModel = Model<IActivity>
