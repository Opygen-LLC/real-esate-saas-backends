import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Must be a valid ObjectId')
const optionalObjectId = objectId.nullable().optional()
const dateValue = z.union([z.string().trim().min(1), z.date()])
const minorAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const accountType = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
const normalBalance = z.enum(['DEBIT', 'CREDIT'])

const journalLine = z.object({
  accountId: objectId,
  debitMinor: minorAmount.optional().default(0),
  creditMinor: minorAmount.optional().default(0),
  description: z.string().trim().max(500).optional(),
  propertyId: optionalObjectId,
  agentId: optionalObjectId,
  vendorId: optionalObjectId,
  clientId: optionalObjectId,
  shareholderId: optionalObjectId,
}).strict().refine((line) => (line.debitMinor > 0) !== (line.creditMinor > 0), { message: 'Each journal line must contain either a debit or a credit, but not both' })

const journalBody = z.object({
  entryDate: dateValue,
  postingDate: dateValue,
  description: z.string().trim().min(1).max(1000),
  reference: z.string().trim().max(200).optional(),
  fiscalPeriodId: objectId.optional(),
  lines: z.array(journalLine).min(2).max(200),
}).strict()

export const FinanceAccountingValidation = {
  initialize: z.object({ body: z.object({}).strict().optional() }),
  createAccount: z.object({ body: z.object({
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(160),
    type: accountType,
    parentAccountId: optionalObjectId,
    normalBalance: normalBalance.optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    allowManualPosting: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict() }),
  updateAccount: z.object({ params: z.object({ id: objectId }), body: z.object({
    code: z.string().trim().min(1).max(32).optional(),
    name: z.string().trim().min(1).max(160).optional(),
    type: accountType.optional(),
    parentAccountId: optionalObjectId,
    normalBalance: normalBalance.optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    allowManualPosting: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'At least one account field must be provided' }) }),
  idParam: z.object({ params: z.object({ id: objectId }) }),
  listAccounts: z.object({ query: z.object({ type: accountType.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), search: z.string().trim().max(160).optional() }).passthrough() }),
  createFiscalYear: z.object({ body: z.object({ name: z.string().trim().min(1).max(80), startDate: dateValue, endDate: dateValue }).strict() }),
  fiscalYearStatus: z.object({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['OPEN', 'CLOSING', 'CLOSED']) }).strict() }),
  fiscalPeriodStatus: z.object({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['OPEN', 'SOFT_LOCKED', 'CLOSED']) }).strict() }),
  listFiscalPeriods: z.object({ query: z.object({ fiscalYearId: objectId.optional() }).passthrough() }),
  categoryMapping: z.object({ body: z.object({ transactionType: z.enum(['income', 'expense']), category: z.string().trim().min(1).max(100), accountId: objectId }).strict() }),
  createJournal: z.object({ body: journalBody }),
  updateJournal: z.object({ params: z.object({ id: objectId }), body: journalBody.partial().refine((body) => Object.keys(body).length > 0, { message: 'At least one journal field must be provided' }) }),
  reverseJournal: z.object({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(5).max(500), reversalDate: dateValue.optional() }).strict() }),
  listJournals: z.object({ query: z.object({
    status: z.enum(['DRAFT', 'POSTED', 'REVERSED']).optional(),
    sourceType: z.string().trim().max(80).optional(),
    startDate: dateValue.optional(), endDate: dateValue.optional(),
    page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
  }).passthrough() }),
  openingBalances: z.object({ body: journalBody.omit({ fiscalPeriodId: true }).extend({ description: z.string().trim().min(1).max(1000).default('Opening balances') }) }),
  generalLedger: z.object({ query: z.object({
    accountId: objectId.optional(),
    startDate: dateValue.optional(), endDate: dateValue.optional(),
    propertyId: objectId.optional(), agentId: objectId.optional(), vendorId: objectId.optional(), clientId: objectId.optional(), shareholderId: objectId.optional(),
    sourceType: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
  }).passthrough() }),
}
