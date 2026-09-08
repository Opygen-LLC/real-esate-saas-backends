import { Schema, model } from 'mongoose'
import { MATERIAL_UNITS } from '../materialInventory/materialInventory.interface'
import { MATERIAL_PURCHASE_STATUSES, type IMaterialPurchase } from './supplierManagement.interface'

const materialPurchaseSchema = new Schema<IMaterialPurchase>({
  organizationId: { type: String, required: true, index: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'FinanceVendor', required: true, index: true },
  materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
  flatId: { type: String, trim: true, maxlength: 120 },
  quantity: { type: Number, required: true, min: 0.000001 },
  unit: { type: String, enum: MATERIAL_UNITS, required: true },
  unitPriceMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  totalMinor: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  purchaseDate: { type: Date, required: true, index: true },
  expectedDeliveryDate: { type: Date, default: null, index: true },
  paymentDueDate: { type: Date, default: null, index: true },
  actualDeliveryDate: { type: Date, default: null },
  receivedQuantity: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: MATERIAL_PURCHASE_STATUSES, default: 'Ordered', index: true },
  invoiceNumber: { type: String, trim: true, maxlength: 160, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  idempotencyKey: { type: String, trim: true, maxlength: 120 },
  paymentMutationVersion: { type: Number, default: 0, min: 0, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

materialPurchaseSchema.index({ organizationId: 1, supplierId: 1, purchaseDate: -1, _id: -1 }, { name: 'material_purchase_tenant_supplier_date' })
materialPurchaseSchema.index({ organizationId: 1, materialId: 1, purchaseDate: -1, _id: -1 }, { name: 'material_purchase_tenant_material_date' })
materialPurchaseSchema.index({ organizationId: 1, propertyId: 1, purchaseDate: -1, _id: -1 }, { name: 'material_purchase_tenant_property_date' })
materialPurchaseSchema.index({ organizationId: 1, status: 1, expectedDeliveryDate: 1 }, { name: 'material_purchase_tenant_status_expected' })
materialPurchaseSchema.index({ organizationId: 1, status: 1, paymentDueDate: 1 }, { name: 'material_purchase_tenant_status_payment_due' })
materialPurchaseSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: 'material_purchase_tenant_idempotency_unique' })

export const MaterialPurchase = model<IMaterialPurchase>('MaterialPurchase', materialPurchaseSchema)
