import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid record id')
const optionalObjectId = objectId.optional().or(z.literal(''))
const dateInput = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid date')
const paymentMethod = z.enum(['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'])
const money = z.coerce.number().positive('Amount must be greater than zero').max(1_000_000_000_000)
const category = z.string().trim().min(2).max(100)
const optionalUrl = z.string().url().max(2000).optional().or(z.literal(''))

const createTransaction = z.object({ body: z.object({
  type: z.enum(['income', 'expense']),
  category,
  amount: money,
  transactionDate: dateInput,
  paymentMethod,
  status: z.enum(['pending', 'paid', 'cancelled']).default('paid'),
  description: z.string().trim().min(2).max(1000),
  reference: z.string().trim().max(200).optional(),
  vendorId: optionalObjectId,
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
  receiptUrl: optionalUrl,
  recurring: z.boolean().optional(),
}).strict() })

const updateTransaction = z.object({ body: z.object({
  type: z.enum(['income', 'expense']).optional(),
  category: category.optional(),
  amount: money.optional(),
  transactionDate: dateInput.optional(),
  paymentMethod: paymentMethod.optional(),
  status: z.enum(['pending', 'paid', 'cancelled']).optional(),
  description: z.string().trim().min(2).max(1000).optional(),
  reference: z.string().trim().max(200).optional(),
  vendorId: optionalObjectId,
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
  receiptUrl: optionalUrl,
  recurring: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required') })

const voidTransaction = z.object({ body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() })

const invoiceLine = z.object({
  description: z.string().trim().min(2).max(500),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().nonnegative().max(1_000_000_000_000),
}).strict()

const createInvoice = z.object({ body: z.object({
  clientName: z.string().trim().min(2).max(160),
  clientPhone: z.string().trim().max(40).optional(),
  clientEmail: z.string().email().max(200).optional().or(z.literal('')),
  issueDate: dateInput,
  dueDate: dateInput.optional().or(z.literal('')),
  lineItems: z.array(invoiceLine).min(1).max(100),
  discount: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  status: z.enum(['draft', 'sent']).optional(),
  notes: z.string().trim().max(3000).optional(),
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
}).strict().superRefine((value, ctx) => {
  if (value.dueDate && new Date(value.dueDate) < new Date(value.issueDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date cannot be before the issue date' })
  }
  const subtotal = value.lineItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0)
  if (Number(value.discount || 0) > subtotal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: 'Discount cannot exceed invoice subtotal' })
  }
}) })

const updateInvoice = z.object({ body: z.object({
  clientName: z.string().trim().min(2).max(160).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  clientEmail: z.string().email().max(200).optional().or(z.literal('')),
  issueDate: dateInput.optional(),
  dueDate: dateInput.optional().or(z.literal('')),
  lineItems: z.array(invoiceLine).min(1).max(100).optional(),
  discount: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  status: z.enum(['draft', 'sent']).optional(),
  notes: z.string().trim().max(3000).optional(),
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required') })

const recordInvoicePayment = z.object({ body: z.object({
  amount: money,
  paidAt: dateInput,
  paymentMethod,
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
}).strict() })

const voidInvoice = z.object({ body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() })
const archiveInvoice = z.object({ body: z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict() })

const createCommission = z.object({ body: z.object({
  agentId: objectId,
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
  dealReference: z.string().trim().max(200).optional(),
  grossDealValue: z.coerce.number().nonnegative().max(1_000_000_000_000),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  commissionAmount: z.coerce.number().nonnegative().max(1_000_000_000_000),
  agentShare: z.coerce.number().nonnegative().max(1_000_000_000_000),
  companyShare: z.coerce.number().nonnegative().max(1_000_000_000_000),
  status: z.enum(['pending', 'approved']).optional(),
  dueDate: dateInput.optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
}).strict().refine((value) => Math.abs((value.agentShare + value.companyShare) - value.commissionAmount) < 0.01, {
  message: 'Agent share and company share must equal the commission amount', path: ['agentShare'],
}) })

const updateCommission = z.object({ body: z.object({
  agentId: objectId.optional(),
  propertyId: optionalObjectId,
  leadId: optionalObjectId,
  dealReference: z.string().trim().max(200).optional(),
  grossDealValue: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  commissionAmount: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  agentShare: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  companyShare: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  status: z.enum(['pending', 'approved']).optional(),
  dueDate: dateInput.optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required') })

const cancelCommission = z.object({ body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() })

const payCommission = z.object({ body: z.object({
  paidAt: dateInput,
  paymentMethod,
  reference: z.string().trim().max(200).optional(),
}).strict() })

const createVendor = z.object({ body: z.object({
  name: z.string().trim().min(2).max(160),
  category,
  phone: z.string().trim().max(40).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(1000).optional(),
  taxId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).strict() })

const updateVendor = z.object({ body: z.object({
  name: z.string().trim().min(2).max(160).optional(),
  category: category.optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(1000).optional(),
  taxId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required') })

const createBudget = z.object({ body: z.object({
  name: z.string().trim().min(2).max(160),
  category,
  amount: money,
  period: z.enum(['monthly', 'quarterly', 'yearly', 'custom']),
  startDate: dateInput,
  endDate: dateInput,
  alertThresholdPercent: z.coerce.number().int().min(1).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().refine((value) => new Date(value.endDate) >= new Date(value.startDate), { message: 'End date must be after start date', path: ['endDate'] }) })

const updateBudget = z.object({ body: z.object({
  name: z.string().trim().min(2).max(160).optional(),
  category: category.optional(),
  amount: money.optional(),
  period: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
  startDate: dateInput.optional(),
  endDate: dateInput.optional(),
  alertThresholdPercent: z.coerce.number().int().min(1).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(['active', 'archived']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required') })

export const FinanceValidation = {
  createTransaction,
  updateTransaction,
  voidTransaction,
  createInvoice,
  updateInvoice,
  voidInvoice,
  archiveInvoice,
  recordInvoicePayment,
  createCommission,
  updateCommission,
  cancelCommission,
  payCommission,
  createVendor,
  updateVendor,
  createBudget,
  updateBudget,
}
