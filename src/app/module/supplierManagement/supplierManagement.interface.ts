import type mongoose from 'mongoose'
import type { MaterialUnit } from '../materialInventory/materialInventory.interface'

export const MATERIAL_PURCHASE_STATUSES = ['Ordered', 'Partially Received', 'Received', 'Cancelled'] as const
export type MaterialPurchaseStatus = typeof MATERIAL_PURCHASE_STATUSES[number]

export interface IMaterialPurchase {
  organizationId: string
  supplierId: mongoose.Types.ObjectId | string
  materialId: mongoose.Types.ObjectId | string
  propertyId?: mongoose.Types.ObjectId | string | null
  flatId?: string
  quantity: number
  unit: MaterialUnit
  unitPriceMinor: number
  totalMinor: number
  purchaseDate: Date
  expectedDeliveryDate?: Date | null
  actualDeliveryDate?: Date | null
  receivedQuantity: number
  status: MaterialPurchaseStatus
  invoiceNumber?: string
  notes?: string
  idempotencyKey?: string
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IMaterialPurchaseReceipt {
  organizationId: string
  purchaseId: mongoose.Types.ObjectId | string
  materialId: mongoose.Types.ObjectId | string
  quantity: number
  receivedAt: Date
  notes?: string
  stockMovementId: mongoose.Types.ObjectId | string
  idempotencyKey?: string
  createdBy: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export type SupplierInvoiceAssetStatus = 'pending' | 'ready' | 'rejected' | 'deleted'
export type SupplierInvoiceScanStatus = 'pending' | 'clean' | 'infected' | 'skipped'

export interface ISupplierInvoiceAsset {
  organizationId: string
  purchaseId: mongoose.Types.ObjectId | string
  key: string
  originalName: string
  mimeType: string
  declaredSize: number
  size: number
  status: SupplierInvoiceAssetStatus
  scanStatus: SupplierInvoiceScanStatus
  active: boolean
  uploadedBy: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}
