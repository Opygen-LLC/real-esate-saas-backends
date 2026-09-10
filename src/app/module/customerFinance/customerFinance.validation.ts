import { z } from 'zod'
import { INSTALLMENT_FREQUENCIES } from '../../../contracts/websiteCatalog/property'

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid record id')
const money = z.coerce.number().finite().positive().max(1_000_000_000_000)
const optionalMoney = z.coerce.number().finite().nonnegative().max(1_000_000_000_000).optional()
const dateInput = z.union([z.string().min(1), z.date()])

const createBooking = z.object({
  params: z.object({ contactId: objectId }),
  body: z.object({
    propertyId: objectId,
    originatingLeadId: objectId.optional(),
    agreedPrice: money,
    bookingDate: dateInput,
    status: z.enum(['Reserved', 'Active']).optional(),
    bookingAmount: optionalMoney,
    downPaymentAmount: optionalMoney,
    downPaymentPercent: z.coerce.number().min(0).max(100).optional(),
    downPaymentDueDate: dateInput.optional(),
    installmentCount: z.coerce.number().int().min(0).max(600).optional(),
    installmentFrequency: z.enum(INSTALLMENT_FREQUENCIES).optional(),
    firstInstallmentDate: dateInput.optional(),
    handoverPayment: optionalMoney,
    handoverDate: dateInput.optional(),
    registrationPayment: optionalMoney,
    registrationDate: dateInput.optional(),
  }).strict(),
})

const contactId = z.object({ params: z.object({ contactId: objectId }) })
const bookingId = z.object({ params: z.object({ bookingId: objectId }) })

const listCustomers = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    searchTerm: z.string().trim().max(160).optional(),
  }).strict(),
})

const listBookings = z.object({
  params: z.object({ contactId: objectId }),
  query: z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict(),
})

const voidPayment = z.object({
  params: z.object({ bookingId: objectId, paymentId: objectId }),
  body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
})

const recordPayment = z.object({
  params: z.object({ bookingId: objectId }),
  body: z.object({
    amount: money,
    paidAt: dateInput,
    paymentMethod: z.enum(['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other']),
    bankAccountId: objectId.optional(),
    reference: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  }).strict(),
})

export const CustomerFinanceValidation = { createBooking, contactId, bookingId, listCustomers, listBookings, recordPayment, voidPayment }
