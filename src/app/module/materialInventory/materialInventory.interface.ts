import mongoose, { Model } from 'mongoose'

export const MATERIAL_UNITS = ['Bag', 'Ton', 'KG', 'CFT', 'SFT', 'Piece', 'Meter', 'Liter', 'Box', 'Other'] as const
export type MaterialUnit = typeof MATERIAL_UNITS[number]

export const MATERIAL_REQUIREMENT_STATUSES = ['Planned', 'Partially Available', 'Ready', 'Completed', 'Cancelled'] as const
export type MaterialRequirementStatus = typeof MATERIAL_REQUIREMENT_STATUSES[number]

export const STOCK_MOVEMENT_TYPES = ['PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN'] as const
export type StockMovementType = typeof STOCK_MOVEMENT_TYPES[number]

export const STOCK_MOVEMENT_SOURCE_TYPES = ['MANUAL', 'MATERIAL_PURCHASE_RECEIPT'] as const
export type StockMovementSourceType = typeof STOCK_MOVEMENT_SOURCE_TYPES[number]

export interface IMaterial {
  organizationId: string
  name: string
  nameKey: string
  category: string
  unit: MaterialUnit
  minimumStock?: number
  notes?: string
  active: boolean
  stockQuantity: number
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
export type MaterialModel = Model<IMaterial>

export interface IMaterialRequirement {
  organizationId: string
  materialId: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string
  flatId?: string
  requiredQuantity: number
  requiredBy: Date
  notes?: string
  status: MaterialRequirementStatus
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
export type MaterialRequirementModel = Model<IMaterialRequirement>

export interface IStockMovement {
  organizationId: string
  materialId: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string
  flatId?: string
  type: StockMovementType
  quantityDelta: number
  quantityAbsolute: number
  unitPriceMinor?: number
  totalCostMinor?: number
  occurredAt: Date
  notes?: string
  idempotencyKey?: string
  sourceType?: StockMovementSourceType
  sourceId?: mongoose.Types.ObjectId | string
  createdBy: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
export type StockMovementModel = Model<IStockMovement>
