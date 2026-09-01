import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Must be a valid ObjectId')
const dateValue = z.union([z.string().trim().min(1), z.date()])
const report = z.enum([
  'trial-balance', 'balance-sheet', 'profit-loss', 'cash-flow', 'statement-of-equity',
  'general-ledger', 'ar-aging', 'ap-aging', 'property-profitability', 'tax', 'budget-vs-actual',
])
const commonQuery = z.object({
  startDate: dateValue.optional(),
  endDate: dateValue.optional(),
  asOf: dateValue.optional(),
  accountId: objectId.optional(),
  propertyId: objectId.optional(),
  agentId: objectId.optional(),
  vendorId: objectId.optional(),
  clientId: objectId.optional(),
  shareholderId: objectId.optional(),
  sourceType: z.string().trim().max(80).optional(),
  includeZero: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).passthrough()

export const FinanceReportingValidation = {
  common: z.object({ query: commonQuery }),
  drilldown: z.object({ query: commonQuery.extend({ accountId: objectId.optional(), journalEntryId: objectId.optional() }).passthrough() }),
  export: z.object({
    params: z.object({ report }),
    query: commonQuery.extend({ format: z.enum(['pdf', 'csv', 'xlsx']) }).passthrough(),
  }),
}
