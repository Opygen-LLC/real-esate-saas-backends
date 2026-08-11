import { Model } from 'mongoose'

export interface IPropertyType {
  organizationId: string
  name: string
  slug: string
  icon?: string
  description?: string
  isDefault?: boolean
  isActive: boolean
  createdAt?: Date
  updatedAt?: Date
}

export type PropertyTypeModel = Model<IPropertyType>
