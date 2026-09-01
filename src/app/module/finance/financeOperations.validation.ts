import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Must be a valid ObjectId')
const optionalObjectId = objectId.nullable().optional()
const dateValue = z.union([z.string().trim().min(1), z.date()])
const money = z.coerce.number().finite().positive().max(9_000_000_000_000)
const optionalMoney = z.coerce.number().finite().min(-9_000_000_000_000).max(9_000_000_000_000).optional()

const vendorBillLine = z.object({
  description: z.string().trim().min(1).max(500),
  accountId: objectId,
  amount: money.optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  propertyId: optionalObjectId,
}).strict().refine((line) => line.amount !== undefined || line.amountMinor !== undefined, { message: 'Line amount is required' })

export const FinanceOperationsValidation = {
  initialize: z.object({ body: z.object({}).strict().optional() }),
  receivables: z.object({ query: z.object({ asOf: dateValue.optional(), search: z.string().trim().max(160).optional(), includeSettled: z.enum(['true', 'false']).optional() }).passthrough() }),
  payables: z.object({ query: z.object({ asOf: dateValue.optional(), includeSettled: z.enum(['true', 'false']).optional() }).passthrough() }),

  createTaxCode: z.object({ body: z.object({
    code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
    type: z.enum(['VAT', 'SALES_TAX', 'ZERO_RATED', 'EXEMPT', 'WITHHOLDING']),
    direction: z.enum(['OUTPUT', 'INPUT', 'WITHHOLDING']), ratePercent: z.coerce.number().min(0).max(100),
    outputAccountId: optionalObjectId, inputAccountId: optionalObjectId, withholdingAccountId: optionalObjectId,
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict() }),
  updateTaxCode: z.object({ params: z.object({ id: objectId }), body: z.object({
    name: z.string().trim().min(1).max(160).optional(), ratePercent: z.coerce.number().min(0).max(100).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'At least one tax code field must be provided' }) }),

  createBankAccount: z.object({ body: z.object({
    name: z.string().trim().min(1).max(160), type: z.enum(['CHECKING', 'SAVINGS', 'PETTY_CASH', 'CLIENT_MONEY', 'CREDIT_CARD', 'MOBILE_WALLET']),
    bankName: z.string().trim().max(160).optional(), accountName: z.string().trim().max(160).optional(), accountNumberMasked: z.string().trim().max(80).optional(),
    glAccountId: objectId, isDefaultOperating: z.boolean().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict() }),
  updateBankAccount: z.object({ params: z.object({ id: objectId }), body: z.object({
    name: z.string().trim().min(1).max(160).optional(), type: z.enum(['CHECKING', 'SAVINGS', 'PETTY_CASH', 'CLIENT_MONEY', 'CREDIT_CARD', 'MOBILE_WALLET']).optional(),
    bankName: z.string().trim().max(160).optional(), accountName: z.string().trim().max(160).optional(), accountNumberMasked: z.string().trim().max(80).optional(),
    glAccountId: objectId.optional(), isDefaultOperating: z.boolean().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'At least one bank account field must be provided' }) }),
  createBankTransfer: z.object({ body: z.object({ sourceBankAccountId: objectId, destinationBankAccountId: objectId, amount: money, transferDate: dateValue, reference: z.string().trim().max(200).optional(), description: z.string().trim().max(500).optional() }).strict() }),

  createVendorBill: z.object({ body: z.object({
    vendorId: objectId, vendorInvoiceNumber: z.string().trim().max(120).optional(), billDate: dateValue, dueDate: dateValue.optional(),
    lines: z.array(vendorBillLine).min(1).max(100), taxCodeId: optionalObjectId, notes: z.string().trim().max(2000).optional(), propertyId: optionalObjectId,
  }).strict() }),
  updateVendorBill: z.object({ params: z.object({ id: objectId }), body: z.object({
    vendorId: objectId.optional(), vendorInvoiceNumber: z.string().trim().max(120).optional(), billDate: dateValue.optional(), dueDate: dateValue.nullable().optional(),
    lines: z.array(vendorBillLine).min(1).max(100).optional(), taxCodeId: optionalObjectId, notes: z.string().trim().max(2000).optional(), propertyId: optionalObjectId,
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'At least one vendor bill field must be provided' }) }),
  vendorBillId: z.object({ params: z.object({ id: objectId }) }),
  vendorBillList: z.object({ query: z.object({ status: z.enum(['DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(), vendorId: objectId.optional() }).passthrough() }),
  payVendorBill: z.object({ params: z.object({ id: objectId }), body: z.object({ amount: money, paidAt: dateValue, bankAccountId: objectId, reference: z.string().trim().max(200).optional(), notes: z.string().trim().max(500).optional() }).strict() }),
  voidVendorBill: z.object({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(5).max(500) }).strict() }),

  createDeposit: z.object({ body: z.object({
    type: z.enum(['BOOKING_DEPOSIT', 'SECURITY_DEPOSIT', 'ADVANCE', 'CLIENT_MONEY']), clientName: z.string().trim().min(1).max(160),
    clientEmail: z.string().trim().email().max(200).optional().or(z.literal('')), clientPhone: z.string().trim().max(60).optional(),
    leadId: optionalObjectId, propertyId: optionalObjectId, bankAccountId: objectId, amount: money, receivedAt: dateValue,
    reference: z.string().trim().max(200).optional(), notes: z.string().trim().max(2000).optional(),
  }).strict() }),
  depositList: z.object({ query: z.object({ status: z.enum(['OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED']).optional(), type: z.enum(['BOOKING_DEPOSIT', 'SECURITY_DEPOSIT', 'ADVANCE', 'CLIENT_MONEY']).optional() }).passthrough() }),
  applyDeposit: z.object({ params: z.object({ id: objectId }), body: z.object({ invoiceId: objectId, amount: money, appliedAt: dateValue.optional() }).strict() }),
  refundDeposit: z.object({ params: z.object({ id: objectId }), body: z.object({ amount: money, refundedAt: dateValue.optional(), bankAccountId: objectId.optional(), reference: z.string().trim().max(200).optional() }).strict() }),

  bankStatementBody: z.object({ body: z.object({ bankAccountId: objectId, statementNumber: z.string().trim().max(100).optional(), startDate: dateValue, endDate: dateValue, openingBalance: optionalMoney.default(0), closingBalance: optionalMoney.default(0) }).passthrough() }),
  statementId: z.object({ params: z.object({ id: objectId }) }),
  statementList: z.object({ query: z.object({ bankAccountId: objectId.optional(), status: z.enum(['OPEN', 'RECONCILED']).optional() }).passthrough() }),
  matchStatementLine: z.object({ params: z.object({ id: objectId, lineId: objectId }), body: z.object({ journalLineIds: z.array(objectId).min(1).max(100) }).strict() }),
  excludeStatementLine: z.object({ params: z.object({ id: objectId, lineId: objectId }), body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() }),
  ledgerCandidates: z.object({ params: z.object({ id: objectId }), query: z.object({ startDate: dateValue.optional(), endDate: dateValue.optional() }).passthrough() }),
}
