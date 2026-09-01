import { z } from 'zod'

const accountId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Account id must be a valid ObjectId').nullable()
const accountMap = z.object({
  accountsReceivable: accountId.optional(), accountsPayable: accountId.optional(), bank: accountId.optional(),
  commissionRevenue: accountId.optional(), commissionExpense: accountId.optional(), commissionPayable: accountId.optional(),
  clientDeposit: accountId.optional(), shareCapital: accountId.optional(), retainedEarnings: accountId.optional(), rounding: accountId.optional(),
}).strict()
const taxMap = z.object({ outputTax: accountId.optional(), inputTax: accountId.optional(), withholdingTax: accountId.optional() }).strict()

export const FinanceAccountingSettingsValidation = {
  update: z.object({ body: z.object({
    baseCurrency: z.literal('BDT').optional(),
    accountingMethod: z.literal('ACCRUAL').optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    makerCheckerRequired: z.boolean().optional(),
    defaultAccounts: accountMap.partial().optional(),
    taxAccounts: taxMap.partial().optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'At least one accounting setting must be provided' }) }),
}
