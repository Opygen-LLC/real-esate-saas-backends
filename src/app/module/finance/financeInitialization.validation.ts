import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Must be a valid ObjectId')
const dateValue = z.union([z.string().trim().min(1), z.date()])
const paymentMethod = z.enum(['cash', 'bank', 'bkash', 'nagad', 'card', 'cheque', 'other'])
const signedMinor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const nonNegativeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const FinanceInitializationValidation = {
  preview: z.object({ query: z.object({ startDate: dateValue }).passthrough() }),
  paymentMapping: z.object({ body: z.object({ paymentMethod, bankAccountId: objectId }).strict() }),
  activate: z.object({ body: z.object({
    accountingStartDate: dateValue,
    bankOpeningBalances: z.array(z.object({ bankAccountId: objectId, balanceMinor: signedMinor }).strict()).max(50).default([]),
    openingLiabilities: z.array(z.object({ accountId: objectId, amountMinor: nonNegativeMinor, description: z.string().trim().min(1).max(300) }).strict()).max(50).default([]),
    openingEquity: z.array(z.object({ accountId: objectId, amountMinor: nonNegativeMinor, description: z.string().trim().min(1).max(300) }).strict()).max(50).default([]),
    reason: z.string().trim().min(10).max(1000),
  }).strict() }),
}
