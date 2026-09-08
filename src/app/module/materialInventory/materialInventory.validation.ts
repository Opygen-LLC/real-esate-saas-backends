import { z } from 'zod'
import { MATERIAL_REQUIREMENT_STATUSES, MATERIAL_UNITS, STOCK_MOVEMENT_TYPES } from './materialInventory.interface'

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id')
const optionalObjectId = z.union([objectId, z.literal(''), z.null()]).optional().transform((value) => value || undefined)
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional().transform((value) => value || undefined)
const positiveQuantity = z.coerce.number().finite().positive().max(1_000_000_000)
const dateValue = z.coerce.date()

const list = z.object({
  query: z.object({
    searchTerm: z.string().trim().max(160).optional(),
    category: z.string().trim().max(120).optional(),
    active: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().positive().max(1_000_000).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }).strict(),
})

const materialId = z.object({ params: z.object({ materialId: objectId }).strict() })

const createMaterial = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(120),
    unit: z.enum(MATERIAL_UNITS),
    minimumStock: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
    notes: optionalText(2000),
  }).strict(),
})

const updateMaterial = z.object({
  params: z.object({ materialId: objectId }).strict(),
  body: z.object({
    name: z.string().trim().min(1).max(160).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    unit: z.enum(MATERIAL_UNITS).optional(),
    minimumStock: z.union([z.coerce.number().finite().min(0).max(1_000_000_000), z.null()]).optional(),
    notes: z.union([z.string().trim().max(2000), z.null()]).optional(),
    active: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})

const createRequirement = z.object({
  params: z.object({ materialId: objectId }).strict(),
  body: z.object({
    propertyId: optionalObjectId,
    flatId: optionalText(120),
    requiredQuantity: positiveQuantity,
    requiredBy: dateValue,
    notes: optionalText(2000),
    status: z.enum(MATERIAL_REQUIREMENT_STATUSES).optional(),
  }).strict(),
})

const updateRequirement = z.object({
  params: z.object({ requirementId: objectId }).strict(),
  body: z.object({
    propertyId: optionalObjectId,
    flatId: z.union([z.string().trim().max(120), z.null()]).optional(),
    requiredQuantity: positiveQuantity.optional(),
    requiredBy: dateValue.optional(),
    notes: z.union([z.string().trim().max(2000), z.null()]).optional(),
    status: z.enum(MATERIAL_REQUIREMENT_STATUSES).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})

const movement = z.object({
  params: z.object({ materialId: objectId }).strict(),
  body: z.object({
    type: z.enum(STOCK_MOVEMENT_TYPES),
    quantity: z.coerce.number().finite().refine((value) => value !== 0, 'Quantity cannot be zero').refine((value) => Math.abs(value) <= 1_000_000_000, 'Quantity is too large'),
    unitPrice: z.coerce.number().finite().min(0).max(1_000_000_000_000).optional(),
    propertyId: optionalObjectId,
    flatId: optionalText(120),
    occurredAt: dateValue.optional(),
    notes: optionalText(2000),
    idempotencyKey: optionalText(120),
  }).strict().superRefine((value, ctx) => {
    if (value.type === 'PURCHASE' && value.unitPrice === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitPrice'], message: 'Unit price is required for purchases' })
    if (value.type !== 'ADJUSTMENT' && value.quantity < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Use a positive quantity; movement type determines the direction' })
  }),
})

const movements = z.object({
  params: z.object({ materialId: objectId }).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().max(1_000_000).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  }).strict(),
})

export const MaterialInventoryValidation = { list, materialId, createMaterial, updateMaterial, createRequirement, updateRequirement, movement, movements }
