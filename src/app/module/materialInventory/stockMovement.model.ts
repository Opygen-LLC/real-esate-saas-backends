import { Schema, model } from 'mongoose'
import { IStockMovement, STOCK_MOVEMENT_TYPES, StockMovementModel } from './materialInventory.interface'

const stockMovementSchema = new Schema<IStockMovement, StockMovementModel>({
  organizationId: { type: String, required: true, index: true },
  materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
  flatId: { type: String, trim: true, maxlength: 120 },
  type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true, index: true },
  quantityDelta: { type: Number, required: true },
  quantityAbsolute: { type: Number, required: true, min: 0.000001 },
  unitPriceMinor: { type: Number, min: 0 },
  totalCostMinor: { type: Number, min: 0 },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  notes: { type: String, trim: true, maxlength: 2000 },
  idempotencyKey: { type: String, trim: true, maxlength: 120 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

stockMovementSchema.index({ organizationId: 1, materialId: 1, occurredAt: -1, _id: -1 }, { name: 'stock_movement_tenant_material_date' })
stockMovementSchema.index({ organizationId: 1, type: 1, occurredAt: -1 }, { name: 'stock_movement_tenant_type_date' })
stockMovementSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: 'stock_movement_tenant_idempotency_unique' })

export const StockMovement = model<IStockMovement, StockMovementModel>('StockMovement', stockMovementSchema)
