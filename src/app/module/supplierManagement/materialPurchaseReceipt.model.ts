import { Schema, model } from 'mongoose'
import type { IMaterialPurchaseReceipt } from './supplierManagement.interface'

const materialPurchaseReceiptSchema = new Schema<IMaterialPurchaseReceipt>({
  organizationId: { type: String, required: true, index: true },
  purchaseId: { type: Schema.Types.ObjectId, ref: 'MaterialPurchase', required: true, index: true },
  materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  receivedAt: { type: Date, required: true, default: Date.now, index: true },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  stockMovementId: { type: Schema.Types.ObjectId, ref: 'StockMovement', required: true, unique: true },
  idempotencyKey: { type: String, trim: true, maxlength: 120 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

materialPurchaseReceiptSchema.index({ organizationId: 1, purchaseId: 1, receivedAt: -1, _id: -1 }, { name: 'material_purchase_receipt_tenant_purchase_date' })
materialPurchaseReceiptSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: 'material_purchase_receipt_tenant_idempotency_unique' })

export const MaterialPurchaseReceipt = model<IMaterialPurchaseReceipt>('MaterialPurchaseReceipt', materialPurchaseReceiptSchema)
