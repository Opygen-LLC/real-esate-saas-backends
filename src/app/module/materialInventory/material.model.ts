import { Schema, model } from 'mongoose'
import { IMaterial, MATERIAL_UNITS, MaterialModel } from './materialInventory.interface'

const materialSchema = new Schema<IMaterial, MaterialModel>({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  nameKey: { type: String, required: true, trim: true, maxlength: 180 },
  category: { type: String, required: true, trim: true, maxlength: 120 },
  unit: { type: String, enum: MATERIAL_UNITS, required: true },
  minimumStock: { type: Number, min: 0 },
  notes: { type: String, trim: true, maxlength: 2000 },
  active: { type: Boolean, default: true, required: true, index: true },
  stockQuantity: { type: Number, default: 0, required: true, min: 0, select: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

materialSchema.index({ organizationId: 1, nameKey: 1 }, { unique: true, name: 'material_tenant_name_unique' })
materialSchema.index({ organizationId: 1, active: 1, name: 1 }, { name: 'material_tenant_active_name' })
materialSchema.index({ organizationId: 1, category: 1, name: 1 }, { name: 'material_tenant_category_name' })

export const Material = model<IMaterial, MaterialModel>('Material', materialSchema)
