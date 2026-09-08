import { z } from 'zod'
import { MATERIAL_PURCHASE_STATUSES } from './supplierManagement.interface'

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id')
const optionalObjectId = z.union([objectId, z.literal(''), z.null()]).optional().transform((value) => value || undefined)
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional().transform((value) => value || undefined)
const dateValue = z.coerce.date()
const positiveQuantity = z.coerce.number().finite().positive().max(1_000_000_000)
const money = z.coerce.number().finite().min(0).max(1_000_000_000_000)
const paymentMethod = z.enum(['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'])
const pagination = {
  page: z.coerce.number().int().positive().max(1_000_000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}

const listSuppliers = z.object({ query: z.object({
  searchTerm: z.string().trim().max(160).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  materialId: objectId.optional(),
  ...pagination,
}).strict() })

const availableVendors = z.object({ query: z.object({ searchTerm: z.string().trim().max(160).optional() }).strict() })

const supplierId = z.object({ params: z.object({ supplierId: objectId }).strict() })

const createSupplier = z.object({ body: z.object({
  vendorId: optionalObjectId,
  name: z.string().trim().min(2).max(160).optional(),
  contactPerson: optionalText(160),
  phone: optionalText(40),
  email: z.union([z.string().trim().email().max(200), z.literal(''), z.null()]).optional().transform((value) => value || undefined),
  address: optionalText(1000),
  materialsSupplied: z.array(objectId).max(200).default([]),
  notes: optionalText(2000),
}).strict().superRefine((value, ctx) => {
  if (!value.vendorId && !value.name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Supplier name is required when not linking an existing vendor' })
}) })

const updateSupplier = z.object({
  params: z.object({ supplierId: objectId }).strict(),
  body: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    contactPerson: z.union([z.string().trim().max(160), z.null()]).optional(),
    phone: z.union([z.string().trim().max(40), z.null()]).optional(),
    email: z.union([z.string().trim().email().max(200), z.literal(''), z.null()]).optional(),
    address: z.union([z.string().trim().max(1000), z.null()]).optional(),
    materialsSupplied: z.array(objectId).max(200).optional(),
    notes: z.union([z.string().trim().max(2000), z.null()]).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})

const listPurchases = z.object({ query: z.object({
  supplierId: objectId.optional(),
  materialId: objectId.optional(),
  propertyId: objectId.optional(),
  status: z.enum(MATERIAL_PURCHASE_STATUSES).optional(),
  searchTerm: z.string().trim().max(160).optional(),
  startDate: dateValue.optional(),
  endDate: dateValue.optional(),
  ...pagination,
}).strict() })

const createPurchase = z.object({ body: z.object({
  supplierId: objectId,
  materialId: objectId,
  quantity: positiveQuantity,
  unitPrice: money,
  purchaseDate: dateValue,
  expectedDeliveryDate: dateValue.optional(),
  paymentDueDate: dateValue.optional(),
  invoiceNumber: optionalText(160),
  propertyId: optionalObjectId,
  flatId: optionalText(120),
  notes: optionalText(2000),
  idempotencyKey: optionalText(120),
}).strict().superRefine((value, ctx) => {
  if (value.expectedDeliveryDate && value.expectedDeliveryDate < value.purchaseDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedDeliveryDate'], message: 'Expected delivery date cannot be before purchase date' })
}) })

const purchaseId = z.object({ params: z.object({ purchaseId: objectId }).strict() })

const updatePurchase = z.object({
  params: z.object({ purchaseId: objectId }).strict(),
  body: z.object({
    expectedDeliveryDate: z.union([dateValue, z.null()]).optional(),
    paymentDueDate: z.union([dateValue, z.null()]).optional(),
    invoiceNumber: z.union([z.string().trim().max(160), z.null()]).optional(),
    notes: z.union([z.string().trim().max(2000), z.null()]).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})

const receivePurchase = z.object({
  params: z.object({ purchaseId: objectId }).strict(),
  body: z.object({
    quantity: positiveQuantity,
    receivedAt: dateValue.optional(),
    notes: optionalText(1000),
    idempotencyKey: optionalText(120),
  }).strict(),
})

const recordPayment = z.object({
  params: z.object({ purchaseId: objectId }).strict(),
  body: z.object({
    amount: z.coerce.number().finite().positive().max(1_000_000_000_000),
    paidAt: dateValue.optional(),
    paymentMethod,
    bankAccountId: optionalObjectId,
    reference: optionalText(200),
    idempotencyKey: optionalText(120),
  }).strict(),
})

const voidPayment = z.object({
  params: z.object({ purchaseId: objectId, paymentId: objectId }).strict(),
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
})

const cancelPurchase = z.object({
  params: z.object({ purchaseId: objectId }).strict(),
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
})

const latestPrices = z.object({ params: z.object({ materialId: objectId }).strict() })

const costSummary = z.object({ query: z.object({
  propertyId: objectId.optional(),
  startDate: dateValue.optional(),
  endDate: dateValue.optional(),
}).strict() })

const presignInvoice = z.object({
  params: z.object({ purchaseId: objectId }).strict(),
  body: z.object({
    originalName: z.string().trim().min(1).max(255),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
    size: z.coerce.number().int().positive().max(10 * 1024 * 1024),
  }).strict(),
})

const completeInvoice = z.object({ params: z.object({ purchaseId: objectId, assetId: objectId }).strict() })

export const SupplierManagementValidation = {
  listSuppliers,
  availableVendors,
  supplierId,
  createSupplier,
  updateSupplier,
  listPurchases,
  createPurchase,
  purchaseId,
  updatePurchase,
  receivePurchase,
  recordPayment,
  voidPayment,
  cancelPurchase,
  latestPrices,
  costSummary,
  presignInvoice,
  completeInvoice,
}
