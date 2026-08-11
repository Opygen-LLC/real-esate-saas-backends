import { Model } from 'mongoose'

export interface IAmenity {
  organizationId: string
  name: string
  category: 'features' | 'facilities' | 'security' | 'wellness' | 'outdoor' | 'eco'
  icon?: string
  isDefault?: boolean
  isActive: boolean
  createdAt?: Date
  updatedAt?: Date
}

export type AmenityModel = Model<IAmenity>
