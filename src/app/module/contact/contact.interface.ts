import { Model } from 'mongoose'

export type IContactType = 'Buyer' | 'Seller' | 'Tenant' | 'Landlord' | 'Investor' | 'Partner' | 'Other'

export interface IContact {
  organizationId: string
  name: string
  email?: string
  phone: string
  type: IContactType
  address?: string
  city?: string
  state?: string
  country?: string
  company?: string
  notes?: string
  tags: string[]
  createdAt?: Date
  updatedAt?: Date
}

export type IContactFilter = {
  searchTerm?: string
  organizationId?: string
  type?: string
  city?: string
  tag?: string
}

export type ContactModel = Model<IContact>
