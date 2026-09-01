import httpStatus from 'http-status'
import mongoose, { type ClientSession, type FilterQuery } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { TenantReferenceService } from '../../shared/tenantReference.service'
import { writeAudit } from '../audit/audit.service'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceBankAccount, FinanceTaxCode } from './financeOperations.model'
import { FinanceCategoryMappingService } from './financeCategoryMapping.service'
import type {
  AccountingActor,
  FinanceAccountType,
  FinanceFiscalPeriodStatus,
  FinanceFiscalYearStatus,
  FinanceJournalInput,
  FinanceJournalLineInput,
  FinanceJournalStatus,
  FinanceNormalBalance,
} from './financeAccounting.interface'
import {
  FinanceAccount,
  FinanceAccountingSequence,
  FinanceCategoryAccountMapping,
  FinanceFiscalPeriod,
  FinanceFiscalYear,
  FinanceJournalEntry,
  FinanceJournalLine,
} from './financeAccounting.model'

const MAX_LEDGER_PAGE = 200
const POSTED_LINE_STATUSES: FinanceJournalStatus[] = ['POSTED', 'REVERSED']

const asObjectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}

const asDate = (value: unknown, label: string) => {
  const date = value instanceof Date ? new Date(value) : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return date
}

const asInclusiveEndDate = (value: unknown, label: string) => {
  const raw = String(value || '').trim()
  const date = asDate(value, label)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date.setUTCHours(23, 59, 59, 999)
  return date
}

const actorObjectId = (actor: AccountingActor) => asObjectId(actor.id, 'authenticated user')
const normalBalanceForType = (type: FinanceAccountType): FinanceNormalBalance => ['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT'

const audit = async (
  organizationId: string,
  actor: AccountingActor,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
  session?: ClientSession,
) => writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)

const accountingTransaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let result: T | undefined
      await session.withTransaction(async () => { result = await work(session) })
      if (result === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Accounting transaction did not complete')
      return result
    } finally { await session.endSession() }
  }
  if (config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Accounting writes require a MongoDB replica set or mongos in production')
  }
  return work()
}

const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}

const nextJournalNumber = async (organizationId: string, postingDate: Date, session?: ClientSession) => {
  const year = postingDate.getUTCFullYear()
  const sequence = await FinanceAccountingSequence.findOneAndUpdate(
    { organizationId, key: `journal:${year}` },
    { $inc: { value: 1 }, $setOnInsert: { organizationId, key: `journal:${year}` } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  ).lean()
  if (!sequence) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to generate journal number')
  return `JRN-${year}-${String(sequence.value).padStart(6, '0')}`
}

const defaultAccountDefinitions: Array<{
  code: string
  name: string
  type: FinanceAccountType
  parentCode?: string
  systemKey: string
  allowManualPosting: boolean
}> = [
  { code: '1000', name: 'Assets', type: 'ASSET', systemKey: 'ASSETS_ROOT', allowManualPosting: false },
  { code: '1100', name: 'Cash & Cash Equivalents', type: 'ASSET', parentCode: '1000', systemKey: 'CASH_ROOT', allowManualPosting: false },
  { code: '1110', name: 'Operating Bank', type: 'ASSET', parentCode: '1100', systemKey: 'OPERATING_BANK', allowManualPosting: true },
  { code: '1120', name: 'Petty Cash', type: 'ASSET', parentCode: '1100', systemKey: 'PETTY_CASH', allowManualPosting: true },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET', parentCode: '1000', systemKey: 'ACCOUNTS_RECEIVABLE', allowManualPosting: true },
  { code: '1300', name: 'Prepaid Expenses', type: 'ASSET', parentCode: '1000', systemKey: 'PREPAID_EXPENSES', allowManualPosting: true },
  { code: '1310', name: 'Input Tax Receivable', type: 'ASSET', parentCode: '1000', systemKey: 'INPUT_TAX', allowManualPosting: true },

  { code: '2000', name: 'Liabilities', type: 'LIABILITY', systemKey: 'LIABILITIES_ROOT', allowManualPosting: false },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY', parentCode: '2000', systemKey: 'ACCOUNTS_PAYABLE', allowManualPosting: true },
  { code: '2200', name: 'Agent Commission Payable', type: 'LIABILITY', parentCode: '2000', systemKey: 'COMMISSION_PAYABLE', allowManualPosting: true },
  { code: '2300', name: 'Client Deposits', type: 'LIABILITY', parentCode: '2000', systemKey: 'CLIENT_DEPOSITS', allowManualPosting: true },
  { code: '2400', name: 'Tax Payable', type: 'LIABILITY', parentCode: '2000', systemKey: 'OUTPUT_TAX', allowManualPosting: true },
  { code: '2410', name: 'Withholding Tax Payable', type: 'LIABILITY', parentCode: '2000', systemKey: 'WITHHOLDING_TAX', allowManualPosting: true },
  { code: '2500', name: 'Loans Payable', type: 'LIABILITY', parentCode: '2000', systemKey: 'LOANS_PAYABLE', allowManualPosting: true },

  { code: '3000', name: 'Equity', type: 'EQUITY', systemKey: 'EQUITY_ROOT', allowManualPosting: false },
  { code: '3100', name: 'Share Capital', type: 'EQUITY', parentCode: '3000', systemKey: 'SHARE_CAPITAL', allowManualPosting: true },
  { code: '3200', name: 'Additional Paid-in Capital', type: 'EQUITY', parentCode: '3000', systemKey: 'ADDITIONAL_PAID_IN_CAPITAL', allowManualPosting: true },
  { code: '3300', name: 'Retained Earnings', type: 'EQUITY', parentCode: '3000', systemKey: 'RETAINED_EARNINGS', allowManualPosting: true },
  { code: '3400', name: 'Current Year Earnings', type: 'EQUITY', parentCode: '3000', systemKey: 'CURRENT_YEAR_EARNINGS', allowManualPosting: false },

  { code: '4000', name: 'Revenue', type: 'REVENUE', systemKey: 'REVENUE_ROOT', allowManualPosting: false },
  { code: '4100', name: 'Sales Commission Revenue', type: 'REVENUE', parentCode: '4000', systemKey: 'SALES_COMMISSION_REVENUE', allowManualPosting: true },
  { code: '4200', name: 'Leasing Commission Revenue', type: 'REVENUE', parentCode: '4000', systemKey: 'LEASING_COMMISSION_REVENUE', allowManualPosting: true },
  { code: '4300', name: 'Management Revenue', type: 'REVENUE', parentCode: '4000', systemKey: 'MANAGEMENT_REVENUE', allowManualPosting: true },
  { code: '4400', name: 'Service Fees', type: 'REVENUE', parentCode: '4000', systemKey: 'SERVICE_FEES', allowManualPosting: true },

  { code: '5000', name: 'Expenses', type: 'EXPENSE', systemKey: 'EXPENSES_ROOT', allowManualPosting: false },
  { code: '5100', name: 'Agent Commission Expense', type: 'EXPENSE', parentCode: '5000', systemKey: 'COMMISSION_EXPENSE', allowManualPosting: true },
  { code: '5200', name: 'Marketing', type: 'EXPENSE', parentCode: '5000', systemKey: 'MARKETING_EXPENSE', allowManualPosting: true },
  { code: '5300', name: 'Salaries', type: 'EXPENSE', parentCode: '5000', systemKey: 'SALARIES_EXPENSE', allowManualPosting: true },
  { code: '5400', name: 'Office Rent', type: 'EXPENSE', parentCode: '5000', systemKey: 'OFFICE_RENT_EXPENSE', allowManualPosting: true },
  { code: '5500', name: 'Software', type: 'EXPENSE', parentCode: '5000', systemKey: 'SOFTWARE_EXPENSE', allowManualPosting: true },
  { code: '5600', name: 'Legal Fees', type: 'EXPENSE', parentCode: '5000', systemKey: 'LEGAL_FEES_EXPENSE', allowManualPosting: true },
  { code: '5700', name: 'Bank Charges', type: 'EXPENSE', parentCode: '5000', systemKey: 'BANK_CHARGES_EXPENSE', allowManualPosting: true },
  { code: '5710', name: 'Travel & Transport', type: 'EXPENSE', parentCode: '5000', systemKey: 'TRAVEL_EXPENSE', allowManualPosting: true },
  { code: '5720', name: 'Utilities', type: 'EXPENSE', parentCode: '5000', systemKey: 'UTILITIES_EXPENSE', allowManualPosting: true },
  { code: '5730', name: 'Maintenance', type: 'EXPENSE', parentCode: '5000', systemKey: 'MAINTENANCE_EXPENSE', allowManualPosting: true },
  { code: '5800', name: 'Rounding Adjustments', type: 'EXPENSE', parentCode: '5000', systemKey: 'ROUNDING', allowManualPosting: false },
  { code: '5900', name: 'General Operating Expenses', type: 'EXPENSE', parentCode: '5000', systemKey: 'GENERAL_OPERATING_EXPENSE', allowManualPosting: true },
]

const fiscalYearWindow = (reference: Date, startMonth: number) => {
  const referenceYear = reference.getUTCFullYear()
  const referenceMonth = reference.getUTCMonth() + 1
  const startYear = referenceMonth >= startMonth ? referenceYear : referenceYear - 1
  const startDate = new Date(Date.UTC(startYear, startMonth - 1, 1, 0, 0, 0, 0))
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 1, 0, 0, 0, 0) - 1)
  const name = startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}/${String(startYear + 1).slice(-2)}`
  return { startDate, endDate, name }
}

const buildMonthlyPeriods = (startDate: Date, endDate?: Date) => {
  const periods: Array<{ periodNumber: number; name: string; startDate: Date; endDate: Date }> = []
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1, 0, 0, 0, 0))
  const boundary = endDate || new Date(Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), 1, 0, 0, 0, 0) - 1)
  while (cursor <= boundary && periods.length < 24) {
    const periodStart = new Date(Math.max(cursor.getTime(), startDate.getTime()))
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0) - 1)
    const periodEnd = new Date(Math.min(monthEnd.getTime(), boundary.getTime()))
    periods.push({
      periodNumber: periods.length + 1,
      name: cursor.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      startDate: periodStart,
      endDate: periodEnd,
    })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  }
  if (cursor <= boundary) throw new ApiError(httpStatus.BAD_REQUEST, 'Fiscal year cannot contain more than 24 monthly periods')
  return periods
}

const ensureFiscalYearAndPeriods = async (organizationId: string, actor: AccountingActor, startMonth: number, session?: ClientSession) => {
  const actorId = actorObjectId(actor)
  const window = fiscalYearWindow(new Date(), startMonth)
  let year = await withSession(FinanceFiscalYear.findOne({ organizationId, startDate: window.startDate }), session).lean()
  if (!year) {
    const rows = await FinanceFiscalYear.create([{ organizationId, ...window, status: 'OPEN', createdBy: actorId }], session ? { session } : undefined)
    year = rows[0].toObject() as any
  }
  const periods = buildMonthlyPeriods(window.startDate)
  for (const period of periods) {
    await FinanceFiscalPeriod.updateOne(
      { organizationId, fiscalYearId: year._id, periodNumber: period.periodNumber },
      { $setOnInsert: { organizationId, fiscalYearId: year._id, ...period, status: 'OPEN', createdBy: actorId } },
      { upsert: true, session, setDefaultsOnInsert: true },
    )
  }
  return year
}

const initialize = async (organizationId: string, actor: AccountingActor) => accountingTransaction(async (session) => {
  if (!organizationId) throw new ApiError(httpStatus.FORBIDDEN, 'Tenant context required')
  const actorId = actorObjectId(actor)
  let settings = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  const baseCurrency = String(settings?.baseCurrency || 'BDT').toUpperCase()
  const fiscalYearStartMonth = Number(settings?.fiscalYearStartMonth || 1)
  const accountsByCode = new Map<string, any>()

  for (const definition of defaultAccountDefinitions) {
    const parentAccountId = definition.parentCode ? accountsByCode.get(definition.parentCode)?._id : null
    let account = await withSession(FinanceAccount.findOne({ organizationId, code: definition.code }), session).lean()
    if (account && (!account.isSystem || account.systemKey !== definition.systemKey)) {
      throw new ApiError(httpStatus.CONFLICT, `Account code ${definition.code} is reserved by the default Chart of Accounts. Rename the custom account before initialization.`)
    }
    if (!account) {
      account = await FinanceAccount.findOneAndUpdate(
        { organizationId, code: definition.code },
        {
          $setOnInsert: {
            organizationId,
            code: definition.code,
            name: definition.name,
            type: definition.type,
            parentAccountId,
            normalBalance: normalBalanceForType(definition.type),
            currency: baseCurrency,
            systemKey: definition.systemKey,
            isSystem: true,
            allowManualPosting: definition.allowManualPosting,
            status: 'ACTIVE',
            createdBy: actorId,
          },
        },
        { upsert: true, new: true, session, setDefaultsOnInsert: true },
      ).lean()
    }
    if (!account) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to initialize account ${definition.code}`)
    accountsByCode.set(definition.code, account)
  }

  const accountId = (code: string) => accountsByCode.get(code)?._id || null
  const now = new Date()
  settings = await FinanceAccountingSettings.findOneAndUpdate(
    { organizationId },
    {
      $set: {
        baseCurrency,
        accountingMethod: 'ACCRUAL',
        fiscalYearStartMonth,
        initializedAt: settings?.initializedAt || now,
        initializedBy: settings?.initializedBy || actor.id,
        updatedBy: actor.id,
        'defaultAccounts.accountsReceivable': accountId('1200'),
        'defaultAccounts.accountsPayable': accountId('2100'),
        'defaultAccounts.bank': accountId('1110'),
        'defaultAccounts.commissionRevenue': accountId('4100'),
        'defaultAccounts.commissionExpense': accountId('5100'),
        'defaultAccounts.commissionPayable': accountId('2200'),
        'defaultAccounts.clientDeposit': accountId('2300'),
        'defaultAccounts.shareCapital': accountId('3100'),
        'defaultAccounts.retainedEarnings': accountId('3300'),
        'defaultAccounts.rounding': accountId('5800'),
        'taxAccounts.outputTax': accountId('2400'),
        'taxAccounts.inputTax': accountId('1310'),
        'taxAccounts.withholdingTax': accountId('2410'),
      },
      $setOnInsert: { organizationId, initializedAt: now, initializedBy: actor.id },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, session },
  ).lean()
  if (!settings) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to initialize accounting settings')

  await FinanceCategoryMappingService.ensureDefaults(organizationId, actor, session)
  await FinanceBankAccount.updateOne(
    { organizationId, glAccountId: accountId('1110') },
    { $setOnInsert: { organizationId, name: 'Operating Bank', type: 'CHECKING', currency: baseCurrency, glAccountId: accountId('1110'), isDefaultOperating: true, status: 'ACTIVE', createdBy: actorId } },
    { upsert: true, session, setDefaultsOnInsert: true },
  )
  await FinanceTaxCode.updateOne(
    { organizationId, code: 'ZERO' },
    { $setOnInsert: { organizationId, code: 'ZERO', name: 'Zero Rated', type: 'ZERO_RATED', direction: 'OUTPUT', rateBasisPoints: 0, outputAccountId: accountId('2400'), status: 'ACTIVE', isSystemDefault: true, createdBy: actorId } },
    { upsert: true, session, setDefaultsOnInsert: true },
  )
  await FinanceTaxCode.updateOne(
    { organizationId, code: 'EXEMPT' },
    { $setOnInsert: { organizationId, code: 'EXEMPT', name: 'Exempt', type: 'EXEMPT', direction: 'OUTPUT', rateBasisPoints: 0, outputAccountId: accountId('2400'), status: 'ACTIVE', isSystemDefault: true, createdBy: actorId } },
    { upsert: true, session, setDefaultsOnInsert: true },
  )
  const year = await ensureFiscalYearAndPeriods(organizationId, actor, fiscalYearStartMonth, session)
  await audit(organizationId, actor, 'finance.accounting_initialized', 'financeAccountingSettings', String(settings._id), 'Double-entry accounting initialized', { baseCurrency, fiscalYearId: String(year._id) }, session)
  return { settings, fiscalYear: year, accountsCreatedOrPresent: defaultAccountDefinitions.length }
})

const listAccounts = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const filter: FilterQuery<any> = { organizationId }
  if (query.type) filter.type = String(query.type).toUpperCase()
  if (query.status) filter.status = String(query.status).toUpperCase()
  if (query.search) {
    const escaped = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [{ code: { $regex: escaped, $options: 'i' } }, { name: { $regex: escaped, $options: 'i' } }]
  }
  return FinanceAccount.find(filter).sort({ code: 1, _id: 1 }).lean()
}

const getAccount = async (organizationId: string, accountId: string, session?: ClientSession) => {
  const query = FinanceAccount.findOne({ _id: asObjectId(accountId, 'account id'), organizationId })
  if (session) query.session(session)
  const account = await query.lean()
  if (!account) throw new ApiError(httpStatus.NOT_FOUND, 'Finance account not found')
  return account
}

const assertParentAccount = async (organizationId: string, parentAccountId: unknown, type: FinanceAccountType, session?: ClientSession, accountId?: string) => {
  if (!parentAccountId) return null
  const parent = await getAccount(organizationId, String(parentAccountId), session)
  if (parent.status !== 'ACTIVE') throw new ApiError(httpStatus.BAD_REQUEST, 'Parent account is inactive')
  if (parent.type !== type) throw new ApiError(httpStatus.BAD_REQUEST, 'Parent account must have the same account type')
  if (!accountId) return parent._id

  const target = String(asObjectId(accountId, 'account id'))
  const visited = new Set<string>()
  let cursor: any = parent
  while (cursor) {
    const cursorId = String(cursor._id)
    if (cursorId === target) throw new ApiError(httpStatus.BAD_REQUEST, 'Account hierarchy cannot contain a cycle')
    if (visited.has(cursorId)) throw new ApiError(httpStatus.CONFLICT, 'Existing account hierarchy contains a cycle')
    visited.add(cursorId)
    if (!cursor.parentAccountId) break
    cursor = await getAccount(organizationId, String(cursor.parentAccountId), session)
  }
  return parent._id
}

const assertAccountingInitialized = async (organizationId: string, session?: ClientSession) => {
  const query = FinanceAccount.exists({ organizationId, isSystem: true, systemKey: 'ASSETS_ROOT' })
  if (session) query.session(session)
  if (!await query) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before using the double-entry ledger')
}

const createAccount = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => accountingTransaction(async (session) => {
  await assertAccountingInitialized(organizationId, session)
  const type = String(input.type).toUpperCase() as FinanceAccountType
  const parentAccountId = await assertParentAccount(organizationId, input.parentAccountId, type, session)
  const settingsQuery = FinanceAccountingSettings.findOne({ organizationId })
  if (session) settingsQuery.session(session)
  const settings = await settingsQuery.lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before creating accounts')
  const accountCurrency = String(input.currency || settings.baseCurrency).toUpperCase()
  if (accountCurrency !== String(settings.baseCurrency).toUpperCase()) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Custom account currency ${accountCurrency} must match base ledger currency ${settings.baseCurrency}`, '', 'ACCOUNTING_CURRENCY_MISMATCH')
  }
  let created: any
  try {
    const rows = await FinanceAccount.create([{
      organizationId,
      code: String(input.code).trim(),
      name: String(input.name).trim(),
      type,
      parentAccountId,
      normalBalance: input.normalBalance || normalBalanceForType(type),
      currency: accountCurrency,
      isSystem: false,
      systemKey: null,
      allowManualPosting: input.allowManualPosting !== false,
      status: input.status || 'ACTIVE',
      createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    created = rows[0]
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'An account with this code already exists')
    throw error
  }
  await audit(organizationId, actor, 'finance.account_created', 'financeAccount', String(created._id), 'Custom finance account created', { code: created.code, name: created.name, type: created.type }, session)
  return created.toObject()
})

const updateAccount = async (organizationId: string, actor: AccountingActor, accountId: string, input: Record<string, any>) => accountingTransaction(async (session) => {
  await assertAccountingInitialized(organizationId, session)
  const account: any = await withSession(FinanceAccount.findOne({ _id: asObjectId(accountId, 'account id'), organizationId }), session)
  if (!account) throw new ApiError(httpStatus.NOT_FOUND, 'Finance account not found')
  const protectedKeys = ['code', 'type', 'parentAccountId', 'normalBalance', 'currency', 'isSystem', 'systemKey', 'allowManualPosting', 'status']
  if (account.isSystem && protectedKeys.some((key) => input[key] !== undefined)) {
    throw new ApiError(httpStatus.CONFLICT, 'System account structure and posting controls are protected')
  }
  const before = account.toObject()
  if (input.currency !== undefined) {
    const settingsQuery = FinanceAccountingSettings.findOne({ organizationId })
    if (session) settingsQuery.session(session)
    const settings = await settingsQuery.lean()
    if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before updating accounts')
    if (String(input.currency).toUpperCase() !== String(settings.baseCurrency).toUpperCase()) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Custom account currency must match base ledger currency ${settings.baseCurrency}`, '', 'ACCOUNTING_CURRENCY_MISMATCH')
    }
  }
  const nextType = (input.type || account.type) as FinanceAccountType
  const structuralChanged =
    (input.type !== undefined && input.type !== account.type)
    || (input.parentAccountId !== undefined && String(input.parentAccountId || '') !== String(account.parentAccountId || ''))
    || (input.normalBalance !== undefined && input.normalBalance !== account.normalBalance)
    || (input.currency !== undefined && String(input.currency).toUpperCase() !== String(account.currency).toUpperCase())
  if (structuralChanged) {
    const usedQuery = FinanceJournalLine.exists({ organizationId, accountId: account._id })
    if (session) usedQuery.session(session)
    if (await usedQuery) throw new ApiError(httpStatus.CONFLICT, 'Account type, hierarchy, normal balance, and currency cannot be changed after journal activity exists')
  }
  if (input.type !== undefined && input.type !== account.type) {
    const childQuery = FinanceAccount.exists({ organizationId, parentAccountId: account._id })
    if (session) childQuery.session(session)
    if (await childQuery) throw new ApiError(httpStatus.CONFLICT, 'Account type cannot be changed while child accounts exist')
  }
  if (input.parentAccountId !== undefined) {
    account.parentAccountId = await assertParentAccount(organizationId, input.parentAccountId, nextType, session, accountId)
  } else if (input.type !== undefined && account.parentAccountId) {
    await assertParentAccount(organizationId, account.parentAccountId, nextType, session, accountId)
  }
  if (input.status === 'INACTIVE' && account.status !== 'INACTIVE') {
    const [mapped, bankLinked, taxLinked] = await Promise.all([
      withSession(FinanceCategoryAccountMapping.exists({ organizationId, accountId: account._id }), session),
      withSession(FinanceBankAccount.exists({ organizationId, glAccountId: account._id, status: 'ACTIVE' }), session),
      withSession(FinanceTaxCode.exists({ organizationId, status: 'ACTIVE', $or: [{ outputAccountId: account._id }, { inputAccountId: account._id }, { withholdingAccountId: account._id }] }), session),
    ])
    if (mapped) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be made inactive while finance categories are mapped to it')
    if (bankLinked) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be made inactive while an active bank account is linked to it')
    if (taxLinked) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be made inactive while an active tax code is linked to it')
  }
  for (const key of ['code', 'name', 'type', 'normalBalance', 'currency', 'allowManualPosting', 'status'] as const) {
    if (input[key] !== undefined) account[key] = input[key]
  }
  if (input.type !== undefined && input.normalBalance === undefined) account.normalBalance = normalBalanceForType(nextType)
  account.updatedBy = actorObjectId(actor)
  try {
    await account.save({ session })
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'An account with this code already exists')
    throw error
  }
  await audit(organizationId, actor, 'finance.account_updated', 'financeAccount', String(account._id), 'Finance account updated', { before: { code: before.code, name: before.name, status: before.status }, after: { code: account.code, name: account.name, status: account.status } }, session)
  return account.toObject()
})

const deleteAccount = async (organizationId: string, actor: AccountingActor, accountId: string) => accountingTransaction(async (session) => {
  const account: any = await withSession(FinanceAccount.findOne({ _id: asObjectId(accountId, 'account id'), organizationId }), session)
  if (!account) throw new ApiError(httpStatus.NOT_FOUND, 'Finance account not found')
  if (account.isSystem) throw new ApiError(httpStatus.CONFLICT, 'System accounts cannot be deleted')
  const [child, used, mapped, bankLinked, taxLinked] = await Promise.all([
    withSession(FinanceAccount.exists({ organizationId, parentAccountId: account._id }), session),
    withSession(FinanceJournalLine.exists({ organizationId, accountId: account._id }), session),
    withSession(FinanceCategoryAccountMapping.exists({ organizationId, accountId: account._id }), session),
    withSession(FinanceBankAccount.exists({ organizationId, glAccountId: account._id }), session),
    withSession(FinanceTaxCode.exists({ organizationId, $or: [{ outputAccountId: account._id }, { inputAccountId: account._id }, { withholdingAccountId: account._id }] }), session),
  ])
  if (child) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be deleted while it has child accounts')
  if (used) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be deleted after it has been used in a journal')
  if (mapped) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be deleted while finance categories are mapped to it')
  if (bankLinked) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be deleted while a bank account is linked to it')
  if (taxLinked) throw new ApiError(httpStatus.CONFLICT, 'Account cannot be deleted while a tax code is linked to it')
  await FinanceAccount.deleteOne({ _id: account._id, organizationId }, { session })
  await audit(organizationId, actor, 'finance.account_deleted', 'financeAccount', String(account._id), 'Unused custom finance account deleted', { code: account.code, name: account.name }, session)
  return { _id: String(account._id), deleted: true }
})

const assertNoFiscalOverlap = async (organizationId: string, startDate: Date, endDate: Date, excludeId?: string, session?: ClientSession) => {
  const filter: Record<string, unknown> = { organizationId, startDate: { $lte: endDate }, endDate: { $gte: startDate } }
  if (excludeId) filter._id = { $ne: asObjectId(excludeId, 'fiscal year id') }
  const query = FinanceFiscalYear.exists(filter)
  if (session) query.session(session)
  if (await query) throw new ApiError(httpStatus.CONFLICT, 'Fiscal year overlaps an existing fiscal year')
}

const createFiscalYear = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => accountingTransaction(async (session) => {
  await assertAccountingInitialized(organizationId, session)
  const startDate = asDate(input.startDate, 'fiscal year start date')
  const endDate = asDate(input.endDate, 'fiscal year end date')
  if (endDate <= startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'Fiscal year end date must be after start date')
  await assertNoFiscalOverlap(organizationId, startDate, endDate, undefined, session)
  const actorId = actorObjectId(actor)
  const rows = await FinanceFiscalYear.create([{ organizationId, name: input.name, startDate, endDate, status: 'OPEN', createdBy: actorId }], session ? { session } : undefined)
  const year: any = rows[0]
  const periods = buildMonthlyPeriods(startDate, endDate)
  if (!periods.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Fiscal year must include at least one period')
  await FinanceFiscalPeriod.insertMany(periods.map((period) => ({ organizationId, fiscalYearId: year._id, ...period, status: 'OPEN', createdBy: actorId })), { session })
  await audit(organizationId, actor, 'finance.fiscal_year_created', 'financeFiscalYear', String(year._id), 'Fiscal year created', { name: year.name, startDate, endDate }, session)
  return year.toObject()
})

const listFiscalYears = (organizationId: string) => FinanceFiscalYear.find({ organizationId }).sort({ startDate: -1 }).lean()
const listFiscalPeriods = async (organizationId: string, fiscalYearId?: string) => {
  const filter: Record<string, unknown> = { organizationId }
  if (fiscalYearId) {
    await getFiscalYear(organizationId, fiscalYearId)
    filter.fiscalYearId = asObjectId(fiscalYearId, 'fiscal year id')
  }
  return FinanceFiscalPeriod.find(filter).sort({ startDate: 1, periodNumber: 1 }).lean()
}

const getFiscalYear = async (organizationId: string, id: string, session?: ClientSession) => {
  const query = FinanceFiscalYear.findOne({ _id: asObjectId(id, 'fiscal year id'), organizationId })
  if (session) query.session(session)
  const row = await query.lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal year not found')
  return row
}

const getFiscalPeriod = async (organizationId: string, id: string, session?: ClientSession) => {
  const query = FinanceFiscalPeriod.findOne({ _id: asObjectId(id, 'fiscal period id'), organizationId })
  if (session) query.session(session)
  const row = await query.lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal period not found')
  return row
}

const setFiscalYearStatus = async (organizationId: string, actor: AccountingActor, id: string, status: FinanceFiscalYearStatus) => accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceFiscalYear.findOne({ _id: asObjectId(id, 'fiscal year id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal year not found')
  const before = row.status
  row.status = status
  row.updatedBy = actorObjectId(actor)
  row.closedAt = status === 'CLOSED' ? new Date() : null
  row.closedBy = status === 'CLOSED' ? actorObjectId(actor) : null
  await row.save({ session })
  await audit(organizationId, actor, status === 'CLOSED' ? 'finance.fiscal_year_closed' : 'finance.fiscal_year_status_changed', 'financeFiscalYear', String(row._id), `Fiscal year status changed to ${status}`, { before, after: status }, session)
  return row.toObject()
})

const setFiscalPeriodStatus = async (organizationId: string, actor: AccountingActor, id: string, status: FinanceFiscalPeriodStatus) => accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceFiscalPeriod.findOne({ _id: asObjectId(id, 'fiscal period id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal period not found')
  const before = row.status
  row.status = status
  row.updatedBy = actorObjectId(actor)
  row.closedAt = status === 'CLOSED' ? new Date() : null
  row.closedBy = status === 'CLOSED' ? actorObjectId(actor) : null
  await row.save({ session })
  await audit(organizationId, actor, status === 'CLOSED' ? 'finance.fiscal_period_closed' : status === 'OPEN' && before !== 'OPEN' ? 'finance.fiscal_period_reopened' : 'finance.fiscal_period_status_changed', 'financeFiscalPeriod', String(row._id), `Fiscal period status changed to ${status}`, { before, after: status }, session)
  return row.toObject()
})

const resolvePostingPeriod = async (organizationId: string, postingDate: Date, requestedPeriodId?: string, session?: ClientSession) => {
  let period: any
  if (requestedPeriodId) {
    period = await getFiscalPeriod(organizationId, requestedPeriodId, session)
    if (postingDate < period.startDate || postingDate > period.endDate) throw new ApiError(httpStatus.BAD_REQUEST, 'Posting date is outside the selected fiscal period')
  } else {
    const query = FinanceFiscalPeriod.findOne({ organizationId, startDate: { $lte: postingDate }, endDate: { $gte: postingDate } }).sort({ startDate: -1 })
    if (session) query.session(session)
    period = await query.lean()
  }
  if (!period) throw new ApiError(httpStatus.CONFLICT, 'No fiscal period exists for the posting date. Initialize or create a fiscal year first.')
  if (period.status === 'CLOSED') throw new ApiError(httpStatus.CONFLICT, 'Posting into a closed fiscal period is not allowed', '', 'FISCAL_PERIOD_CLOSED')
  if (period.status === 'SOFT_LOCKED') throw new ApiError(httpStatus.CONFLICT, 'Posting into a soft-locked fiscal period is not allowed', '', 'FISCAL_PERIOD_SOFT_LOCKED')
  const year = await getFiscalYear(organizationId, String(period.fiscalYearId), session)
  if (year.status === 'CLOSED') throw new ApiError(httpStatus.CONFLICT, 'Posting into a closed fiscal year is not allowed', '', 'FISCAL_YEAR_CLOSED')
  return { period, year }
}

const normalizeMinor = (value: unknown) => {
  const number = Number(value || 0)
  if (!Number.isSafeInteger(number) || number < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Journal amounts must be non-negative safe integers in minor currency units')
  return number
}

const validateLineAmounts = (lines: FinanceJournalLineInput[], requireBalanced: boolean) => {
  if (!Array.isArray(lines) || lines.length < 2) throw new ApiError(httpStatus.BAD_REQUEST, 'A journal requires at least two lines')
  let debit = 0n
  let credit = 0n
  lines.forEach((line, index) => {
    const debitMinor = normalizeMinor(line.debitMinor)
    const creditMinor = normalizeMinor(line.creditMinor)
    if ((debitMinor > 0 && creditMinor > 0) || (debitMinor === 0 && creditMinor === 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Journal line ${index + 1} must contain either a debit or a credit, but not both`)
    }
    debit += BigInt(debitMinor)
    credit += BigInt(creditMinor)
  })
  if (requireBalanced && debit !== credit) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Journal cannot be posted because total debits do not equal total credits', '', 'JOURNAL_NOT_BALANCED', { debitMinor: debit.toString(), creditMinor: credit.toString() })
  }
  return { debitMinor: debit.toString(), creditMinor: credit.toString(), balanced: debit === credit }
}

const assertJournalLineRelations = async (organizationId: string, line: FinanceJournalLineInput, session?: ClientSession) => {
  const checks: Promise<unknown>[] = []
  if (line.propertyId) checks.push(TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, line.propertyId, session))
  if (line.agentId) checks.push(TenantReferenceService.assertAgentBelongsToOrganization(organizationId, line.agentId, session))
  if (line.vendorId) checks.push(TenantReferenceService.assertFinanceVendorBelongsToOrganization(organizationId, line.vendorId, session))
  if (line.clientId) checks.push(TenantReferenceService.assertClientBelongsToOrganization(organizationId, line.clientId, session))
  if (line.shareholderId) throw new ApiError(httpStatus.BAD_REQUEST, 'Shareholder journal dimensions are not available until the Shareholders module is enabled')
  await Promise.all(checks)
}

const assertJournalAccounts = async (organizationId: string, lines: FinanceJournalLineInput[], sourceType: string, session?: ClientSession) => {
  const ids = [...new Set(lines.map((line) => String(line.accountId)))]
  ids.forEach((id) => asObjectId(id, 'journal account id'))
  const query = FinanceAccount.find({ organizationId, _id: { $in: ids }, status: 'ACTIVE' }).lean()
  if (session) query.session(session)
  const accounts = await query
  if (accounts.length !== ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more journal accounts do not belong to this organization or are inactive')
  const accountMap = new Map<string, any>(accounts.map((account: any) => [String(account._id), account]))
  if (sourceType === 'MANUAL' || sourceType === 'OPENING_BALANCE') {
    const blocked = ids.find((id) => !accountMap.get(id)?.allowManualPosting)
    if (blocked) throw new ApiError(httpStatus.BAD_REQUEST, `Account ${accountMap.get(blocked)?.code || blocked} does not allow manual posting`)
  }
  for (const line of lines) await assertJournalLineRelations(organizationId, line, session)
  return accountMap
}

const assertAccountsUseCurrency = (accounts: Map<string, any>, currency: string) => {
  const expected = String(currency).toUpperCase()
  const mismatch = [...accounts.values()].find((account: any) => String(account.currency).toUpperCase() !== expected)
  if (mismatch) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Account ${mismatch.code} uses ${mismatch.currency}, but this ledger posts in base currency ${expected}`, '', 'ACCOUNTING_CURRENCY_MISMATCH')
  }
}

const buildLineDocuments = (
  organizationId: string,
  journal: any,
  lines: FinanceJournalLineInput[],
  status: FinanceJournalStatus,
) => lines.map((line, index) => ({
  organizationId,
  journalEntryId: journal._id,
  journalNumber: journal.journalNumber,
  lineNumber: index + 1,
  accountId: asObjectId(line.accountId, 'journal account id'),
  debitMinor: normalizeMinor(line.debitMinor),
  creditMinor: normalizeMinor(line.creditMinor),
  description: String(line.description || '').trim(),
  currency: journal.currency,
  journalStatus: status,
  postingDate: journal.postingDate,
  sourceType: journal.sourceType,
  propertyId: line.propertyId ? asObjectId(line.propertyId, 'property id') : null,
  agentId: line.agentId ? asObjectId(line.agentId, 'agent id') : null,
  vendorId: line.vendorId ? asObjectId(line.vendorId, 'vendor id') : null,
  clientId: line.clientId ? asObjectId(line.clientId, 'client id') : null,
  shareholderId: line.shareholderId ? asObjectId(line.shareholderId, 'shareholder id') : null,
}))

const createJournalDraftInternal = async (
  organizationId: string,
  actor: AccountingActor,
  input: FinanceJournalInput,
  options: { sourceType: string; sourceId?: string | null; idempotencyKey?: string | null; entryRole?: 'PRIMARY' | 'REVERSAL'; reversalOf?: string | null } = { sourceType: 'MANUAL' },
  session?: ClientSession,
) => {
  await assertAccountingInitialized(organizationId, session)
  const entryDate = asDate(input.entryDate, 'entry date')
  const postingDate = asDate(input.postingDate, 'posting date')
  const sourceType = String(options.sourceType || 'MANUAL').trim().toUpperCase()
  validateLineAmounts(input.lines, false)
  const settingsQuery = FinanceAccountingSettings.findOne({ organizationId })
  if (session) settingsQuery.session(session)
  const settings = await settingsQuery.lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before creating journals')
  const accounts = await assertJournalAccounts(organizationId, input.lines, sourceType, session)
  assertAccountsUseCurrency(accounts, settings.baseCurrency)
  const { period, year } = await resolvePostingPeriod(organizationId, postingDate, input.fiscalPeriodId, session)
  const journalNumber = await nextJournalNumber(organizationId, postingDate, session)
  const actorId = actorObjectId(actor)
  let journalRows
  try {
    journalRows = await FinanceJournalEntry.create([{
      organizationId,
      journalNumber,
      entryDate,
      postingDate,
      status: 'DRAFT',
      entryRole: options.entryRole || 'PRIMARY',
      sourceType,
      sourceId: options.sourceId || null,
      idempotencyKey: options.idempotencyKey || null,
      description: String(input.description || '').trim(),
      reference: String(input.reference || '').trim(),
      currency: settings.baseCurrency,
      fiscalYearId: year._id,
      fiscalPeriodId: period._id,
      createdBy: actorId,
      reversalOf: options.reversalOf ? asObjectId(options.reversalOf, 'reversal journal id') : null,
    }], session ? { session } : undefined)
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This accounting source or idempotency key has already been posted or drafted', '', 'DUPLICATE_ACCOUNTING_POSTING')
    throw error
  }
  const journal = journalRows[0]
  await FinanceJournalLine.insertMany(buildLineDocuments(organizationId, journal, input.lines, 'DRAFT'), { session })
  return journal
}

const getJournal = async (organizationId: string, id: string, session?: ClientSession) => {
  const query = FinanceJournalEntry.findOne({ _id: asObjectId(id, 'journal id'), organizationId })
  if (session) query.session(session)
  const journal = await query.lean()
  if (!journal) throw new ApiError(httpStatus.NOT_FOUND, 'Journal entry not found')
  const linesQuery = FinanceJournalLine.find({ organizationId, journalEntryId: journal._id }).sort({ lineNumber: 1 }).populate('accountId', 'code name type normalBalance status').lean()
  if (session) linesQuery.session(session)
  const lines = await linesQuery
  return { ...journal, lines, totals: validateLineAmounts(lines.map((line: any) => ({ accountId: String(line.accountId?._id || line.accountId), debitMinor: line.debitMinor, creditMinor: line.creditMinor })), false) }
}

const listJournals = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const filter: Record<string, any> = { organizationId }
  if (query.status) filter.status = String(query.status).toUpperCase()
  if (query.sourceType) filter.sourceType = String(query.sourceType).toUpperCase()
  if (query.startDate || query.endDate) filter.postingDate = { ...(query.startDate ? { $gte: asDate(query.startDate, 'start date') } : {}), ...(query.endDate ? { $lte: asInclusiveEndDate(query.endDate, 'end date') } : {}) }
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 25)))
  const [data, total] = await Promise.all([
    FinanceJournalEntry.find(filter).sort({ postingDate: -1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    FinanceJournalEntry.countDocuments(filter),
  ])
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }
}

const createManualJournal = async (organizationId: string, actor: AccountingActor, input: FinanceJournalInput) => accountingTransaction(async (session) => {
  const journal = await createJournalDraftInternal(organizationId, actor, input, { sourceType: 'MANUAL' }, session)
  await audit(organizationId, actor, 'finance.journal_created', 'financeJournalEntry', String(journal._id), 'Manual journal draft created', { journalNumber: journal.journalNumber }, session)
  return getJournal(organizationId, String(journal._id), session)
})

const updateDraftJournal = async (organizationId: string, actor: AccountingActor, id: string, input: Partial<FinanceJournalInput>) => accountingTransaction(async (session) => {
  const journal: any = await withSession(FinanceJournalEntry.findOne({ _id: asObjectId(id, 'journal id'), organizationId }), session)
  if (!journal) throw new ApiError(httpStatus.NOT_FOUND, 'Journal entry not found')
  if (journal.status !== 'DRAFT') throw new ApiError(httpStatus.CONFLICT, 'Posted or reversed journals are immutable')
  if (journal.sourceType !== 'MANUAL' && journal.sourceType !== 'OPENING_BALANCE') throw new ApiError(httpStatus.CONFLICT, 'Automated source journals cannot be edited manually')
  const lines = input.lines || await withSession(FinanceJournalLine.find({ organizationId, journalEntryId: journal._id }).sort({ lineNumber: 1 }), session).lean().then((rows: any[]) => rows.map((line) => ({ accountId: String(line.accountId), debitMinor: line.debitMinor, creditMinor: line.creditMinor, description: line.description, propertyId: line.propertyId ? String(line.propertyId) : null, agentId: line.agentId ? String(line.agentId) : null, vendorId: line.vendorId ? String(line.vendorId) : null, clientId: line.clientId ? String(line.clientId) : null, shareholderId: line.shareholderId ? String(line.shareholderId) : null })))
  validateLineAmounts(lines, false)
  const accountMap = await assertJournalAccounts(organizationId, lines, journal.sourceType, session)
  assertAccountsUseCurrency(accountMap, journal.currency)
  const postingDate = input.postingDate ? asDate(input.postingDate, 'posting date') : journal.postingDate
  const requestedPeriodId = input.fiscalPeriodId !== undefined
    ? input.fiscalPeriodId
    : input.postingDate !== undefined ? undefined : String(journal.fiscalPeriodId)
  const { period, year } = await resolvePostingPeriod(organizationId, postingDate, requestedPeriodId, session)
  if (input.entryDate !== undefined) journal.entryDate = asDate(input.entryDate, 'entry date')
  journal.postingDate = postingDate
  journal.fiscalPeriodId = period._id
  journal.fiscalYearId = year._id
  if (input.description !== undefined) journal.description = input.description
  if (input.reference !== undefined) journal.reference = input.reference
  await journal.save({ session })
  if (input.lines) {
    await FinanceJournalLine.deleteMany({ organizationId, journalEntryId: journal._id }, { session })
    await FinanceJournalLine.insertMany(buildLineDocuments(organizationId, journal, lines, 'DRAFT'), { session })
  } else if (input.postingDate !== undefined || input.fiscalPeriodId !== undefined) {
    await FinanceJournalLine.updateMany({ organizationId, journalEntryId: journal._id }, { $set: { postingDate } }, { session })
  }
  await audit(organizationId, actor, 'finance.journal_updated', 'financeJournalEntry', String(journal._id), 'Manual journal draft updated', { journalNumber: journal.journalNumber }, session)
  return getJournal(organizationId, String(journal._id), session)
})

const postJournalInternal = async (organizationId: string, actor: AccountingActor, id: string, session?: ClientSession) => {
  const journal = await getJournal(organizationId, id, session)
  if (journal.status !== 'DRAFT') throw new ApiError(httpStatus.CONFLICT, 'Only draft journals can be posted')
  const normalizedLines = (journal.lines as any[]).map((line) => ({
    accountId: String(line.accountId?._id || line.accountId),
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
    propertyId: line.propertyId ? String(line.propertyId) : null,
    agentId: line.agentId ? String(line.agentId) : null,
    vendorId: line.vendorId ? String(line.vendorId) : null,
    clientId: line.clientId ? String(line.clientId) : null,
    shareholderId: line.shareholderId ? String(line.shareholderId) : null,
  }))
  const totals = validateLineAmounts(normalizedLines, true)
  const accountMap = await assertJournalAccounts(organizationId, normalizedLines, journal.sourceType, session)
  assertAccountsUseCurrency(accountMap, journal.currency)
  await resolvePostingPeriod(organizationId, journal.postingDate, String(journal.fiscalPeriodId), session)
  const actorId = actorObjectId(actor)
  const now = new Date()
  const updated = await FinanceJournalEntry.findOneAndUpdate(
    { _id: journal._id, organizationId, status: 'DRAFT' },
    { $set: { status: 'POSTED', approvedBy: actorId, postedBy: actorId, postedAt: now } },
    { new: true, session },
  ).lean()
  if (!updated) throw new ApiError(httpStatus.CONFLICT, 'Journal was changed by another request and could not be posted')
  await FinanceJournalLine.updateMany({ organizationId, journalEntryId: journal._id }, { $set: { journalStatus: 'POSTED' } }, { session })
  await audit(organizationId, actor, 'finance.journal_posted', 'financeJournalEntry', String(journal._id), 'Journal posted to the General Ledger', { journalNumber: journal.journalNumber, totals }, session)
  return getJournal(organizationId, String(journal._id), session)
}

const postJournal = async (organizationId: string, actor: AccountingActor, id: string) => accountingTransaction((session) => postJournalInternal(organizationId, actor, id, session))

const deleteDraftJournal = async (organizationId: string, actor: AccountingActor, id: string) => accountingTransaction(async (session) => {
  const journal: any = await withSession(FinanceJournalEntry.findOne({ _id: asObjectId(id, 'journal id'), organizationId }), session)
  if (!journal) throw new ApiError(httpStatus.NOT_FOUND, 'Journal entry not found')
  if (journal.status !== 'DRAFT') throw new ApiError(httpStatus.CONFLICT, 'Posted or reversed journals cannot be deleted')
  await FinanceJournalLine.deleteMany({ organizationId, journalEntryId: journal._id }, { session })
  await FinanceJournalEntry.deleteOne({ _id: journal._id, organizationId }, { session })
  await audit(organizationId, actor, 'finance.journal_draft_deleted', 'financeJournalEntry', String(journal._id), 'Draft journal deleted', { journalNumber: journal.journalNumber }, session)
  return { _id: String(journal._id), deleted: true }
})

const reverseJournalInternal = async (organizationId: string, actor: AccountingActor, id: string, input: { reversalDate?: string | Date; reason: string }, session?: ClientSession) => {
  const original: any = await withSession(FinanceJournalEntry.findOne({ _id: asObjectId(id, 'journal id'), organizationId }), session).lean()
  if (!original) throw new ApiError(httpStatus.NOT_FOUND, 'Journal entry not found')
  if (original.status !== 'POSTED') throw new ApiError(httpStatus.CONFLICT, 'Only a posted journal can be reversed')
  const existing = await withSession(FinanceJournalEntry.exists({ organizationId, reversalOf: original._id }), session)
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'This journal has already been reversed')
  const originalLines: any[] = await withSession(FinanceJournalLine.find({ organizationId, journalEntryId: original._id }).sort({ lineNumber: 1 }), session).lean()
  const reversalDate = input.reversalDate ? asDate(input.reversalDate, 'reversal date') : new Date()
  const reversalInput: FinanceJournalInput = {
    entryDate: reversalDate,
    postingDate: reversalDate,
    description: `Reversal of ${original.journalNumber}: ${String(input.reason).trim()}`,
    reference: original.reference || original.journalNumber,
    lines: originalLines.map((line) => ({
      accountId: String(line.accountId),
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      description: line.description,
      propertyId: line.propertyId ? String(line.propertyId) : null,
      agentId: line.agentId ? String(line.agentId) : null,
      vendorId: line.vendorId ? String(line.vendorId) : null,
      clientId: line.clientId ? String(line.clientId) : null,
      shareholderId: line.shareholderId ? String(line.shareholderId) : null,
    })),
  }
  const reversal = await createJournalDraftInternal(organizationId, actor, reversalInput, { sourceType: 'REVERSAL', entryRole: 'REVERSAL', reversalOf: String(original._id) }, session)
  await postJournalInternal(organizationId, actor, String(reversal._id), session)
  const actorId = actorObjectId(actor)
  const now = new Date()
  const changed = await FinanceJournalEntry.findOneAndUpdate({ _id: original._id, organizationId, status: 'POSTED' }, { $set: { status: 'REVERSED', reversedBy: actorId, reversedAt: now } }, { new: true, session })
  if (!changed) throw new ApiError(httpStatus.CONFLICT, 'Journal was changed by another request and could not be reversed')
  await FinanceJournalLine.updateMany({ organizationId, journalEntryId: original._id }, { $set: { journalStatus: 'REVERSED' } }, { session })
  await audit(organizationId, actor, 'finance.journal_reversed', 'financeJournalEntry', String(original._id), String(input.reason).trim(), { journalNumber: original.journalNumber, reversalJournalId: String(reversal._id), reversalJournalNumber: reversal.journalNumber }, session)
  return { original: await getJournal(organizationId, String(original._id), session), reversal: await getJournal(organizationId, String(reversal._id), session) }
}

const reverseJournal = async (organizationId: string, actor: AccountingActor, id: string, input: { reversalDate?: string | Date; reason: string }) => accountingTransaction((session) => reverseJournalInternal(organizationId, actor, id, input, session))

const createOpeningBalances = async (organizationId: string, actor: AccountingActor, input: FinanceJournalInput) => accountingTransaction(async (session) => {
  validateLineAmounts(input.lines, true)
  const postingDate = asDate(input.postingDate, 'opening balance posting date')
  const priorActivityQuery = FinanceJournalEntry.exists({
    organizationId,
    status: { $in: POSTED_LINE_STATUSES },
    sourceType: { $ne: 'OPENING_BALANCE' },
    postingDate: { $lt: postingDate },
  })
  if (session) priorActivityQuery.session(session)
  if (await priorActivityQuery) {
    throw new ApiError(httpStatus.CONFLICT, 'Opening balance date cannot be after existing posted ledger activity. Use a date on or before the earliest posted journal.')
  }
  const journal = await createJournalDraftInternal(organizationId, actor, input, { sourceType: 'OPENING_BALANCE', sourceId: 'INITIAL', idempotencyKey: `opening-balance:${organizationId}` }, session)
  const posted = await postJournalInternal(organizationId, actor, String(journal._id), session)
  await audit(organizationId, actor, 'finance.opening_balances_posted', 'financeJournalEntry', String(journal._id), 'Opening balances posted', { journalNumber: journal.journalNumber }, session)
  return posted
})

const getGeneralLedger = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const filter: Record<string, any> = { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES } }
  let account: any = null
  if (query.accountId) {
    account = await getAccount(organizationId, String(query.accountId))
    filter.accountId = account._id
  }
  if (query.startDate || query.endDate) filter.postingDate = { ...(query.startDate ? { $gte: asDate(query.startDate, 'start date') } : {}), ...(query.endDate ? { $lte: asInclusiveEndDate(query.endDate, 'end date') } : {}) }
  if (query.propertyId) { await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, query.propertyId); filter.propertyId = asObjectId(query.propertyId, 'property id') }
  if (query.agentId) { await TenantReferenceService.assertAgentBelongsToOrganization(organizationId, query.agentId); filter.agentId = asObjectId(query.agentId, 'agent id') }
  if (query.vendorId) { await TenantReferenceService.assertFinanceVendorBelongsToOrganization(organizationId, query.vendorId); filter.vendorId = asObjectId(query.vendorId, 'vendor id') }
  if (query.clientId) { await TenantReferenceService.assertClientBelongsToOrganization(organizationId, query.clientId); filter.clientId = asObjectId(query.clientId, 'client id') }
  if (query.sourceType) filter.sourceType = String(query.sourceType).trim().toUpperCase()
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(MAX_LEDGER_PAGE, Math.max(1, Number(query.limit || 50)))

  let openingSigned = 0
  if (account && query.startDate) {
    const openingMatch = { ...filter, postingDate: { $lt: asDate(query.startDate, 'start date') } }
    const rows = await FinanceJournalLine.aggregate([{ $match: openingMatch }, { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } }])
    openingSigned = Number(rows[0]?.debit || 0) - Number(rows[0]?.credit || 0)
  }

  const skip = (page - 1) * limit
  const priorPagePromise = account && skip > 0
    ? FinanceJournalLine.aggregate([
      { $match: filter },
      { $sort: { postingDate: 1, createdAt: 1, lineNumber: 1, _id: 1 } },
      { $limit: skip },
      { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } },
    ])
    : Promise.resolve([] as any[])
  const [lines, total, totals, priorPageTotals] = await Promise.all([
    FinanceJournalLine.find(filter).sort({ postingDate: 1, createdAt: 1, lineNumber: 1, _id: 1 }).skip(skip).limit(limit).populate('accountId', 'code name type normalBalance').lean(),
    FinanceJournalLine.countDocuments(filter),
    FinanceJournalLine.aggregate([{ $match: filter }, { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } }]),
    priorPagePromise,
  ])

  const priorPageSigned = account ? Number(priorPageTotals[0]?.debit || 0) - Number(priorPageTotals[0]?.credit || 0) : 0
  let runningSigned = openingSigned + priorPageSigned
  const data = lines.map((line: any) => {
    if (!account) return { ...line, signedBalanceMinor: null, normalBalanceAmountMinor: null }
    runningSigned += Number(line.debitMinor || 0) - Number(line.creditMinor || 0)
    const normalBalance: FinanceNormalBalance = line.accountId?.normalBalance || 'DEBIT'
    return { ...line, signedBalanceMinor: runningSigned, normalBalanceAmountMinor: normalBalance === 'DEBIT' ? runningSigned : -runningSigned }
  })
  const debitMinor = Number(totals[0]?.debit || 0)
  const creditMinor = Number(totals[0]?.credit || 0)
  return {
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    summary: { openingSignedMinor: openingSigned, debitMinor, creditMinor, netSignedMinor: openingSigned + debitMinor - creditMinor, account: account ? { _id: account._id, code: account.code, name: account.name, normalBalance: account.normalBalance } : null },
  }
}

const accountHasPostedActivity = (organizationId: string) => FinanceJournalEntry.exists({ organizationId, status: { $in: ['POSTED', 'REVERSED'] } })

export const FinanceAccountingService = {
  initialize,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  listFiscalYears,
  listFiscalPeriods,
  createFiscalYear,
  setFiscalYearStatus,
  setFiscalPeriodStatus,
  getJournal,
  listJournals,
  createManualJournal,
  updateDraftJournal,
  postJournal,
  deleteDraftJournal,
  reverseJournal,
  createOpeningBalances,
  getGeneralLedger,
  accountHasPostedActivity,
  accountingTransaction,
  createJournalDraftInternal,
  postJournalInternal,
  reverseJournalInternal,
  validateLineAmounts,
}
