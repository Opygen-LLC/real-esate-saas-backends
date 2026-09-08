import { Schema, model } from 'mongoose'
import { IMaterialRequirement, MATERIAL_REQUIREMENT_STATUSES, MaterialRequirementModel } from './materialInventory.interface'

const materialRequirementSchema = new Schema<IMaterialRequirement, MaterialRequirementModel>({
  organizationId: { type: String, required: true, index: true },
  materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
  flatId: { type: String, trim: true, maxlength: 120 },
  requiredQuantity: { type: Number, required: true, min: 0.000001 },
  requiredBy: { type: Date, required: true, index: true },
  notes: { type: String, trim: true, maxlength: 2000 },
  status: { type: String, enum: MATERIAL_REQUIREMENT_STATUSES, default: 'Planned', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

materialRequirementSchema.index({ organizationId: 1, materialId: 1, status: 1, requiredBy: 1 }, { name: 'material_requirement_tenant_material_status_due' })
materialRequirementSchema.index({ organizationId: 1, propertyId: 1, requiredBy: 1 }, { name: 'material_requirement_tenant_property_due' })

export const MaterialRequirement = model<IMaterialRequirement, MaterialRequirementModel>('MaterialRequirement', materialRequirementSchema)
