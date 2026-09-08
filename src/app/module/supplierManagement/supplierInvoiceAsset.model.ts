import { Schema, model } from 'mongoose'
import type { ISupplierInvoiceAsset } from './supplierManagement.interface'

const supplierInvoiceAssetSchema = new Schema<ISupplierInvoiceAsset>({
  organizationId: { type: String, required: true, index: true },
  purchaseId: { type: Schema.Types.ObjectId, ref: 'MaterialPurchase', required: true, index: true },
  key: { type: String, required: true, trim: true, maxlength: 1500 },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  mimeType: { type: String, required: true, trim: true, maxlength: 120 },
  declaredSize: { type: Number, required: true, min: 1 },
  size: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['pending', 'ready', 'rejected', 'deleted'], default: 'pending', index: true },
  scanStatus: { type: String, enum: ['pending', 'clean', 'infected', 'skipped'], default: 'pending' },
  active: { type: Boolean, default: true, required: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

supplierInvoiceAssetSchema.index({ organizationId: 1, purchaseId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'supplier_invoice_asset_tenant_purchase_active_unique' })
supplierInvoiceAssetSchema.index({ organizationId: 1, status: 1, createdAt: 1 }, { name: 'supplier_invoice_asset_tenant_status_created' })

export const SupplierInvoiceAsset = model<ISupplierInvoiceAsset>('SupplierInvoiceAsset', supplierInvoiceAssetSchema)
