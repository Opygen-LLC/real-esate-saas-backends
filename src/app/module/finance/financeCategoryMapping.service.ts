import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import type { AccountingActor, FinanceCategoryMappingType } from './financeAccounting.interface'
import { FinanceAccount, FinanceCategoryAccountMapping } from './financeAccounting.model'

export const FINANCE_OPERATIONAL_CATEGORIES = [
  'Property sales',
  'Rental commission',
  'Consulting',
  'Booking fee',
  'Documentation',
  'Marketing',
  'Facebook ads',
  'Google ads',
  'Office rent',
  'Salary',
  'Transport',
  'Photography',
  'Legal',
  'Utilities',
  'Software',
  'Maintenance',
  'Agent commission',
  'Other',
] as const

const incomeSystemKey: Record<string, string> = {
  'Property sales': 'SALES_COMMISSION_REVENUE',
  'Rental commission': 'LEASING_COMMISSION_REVENUE',
  Consulting: 'SERVICE_FEES',
  'Booking fee': 'SERVICE_FEES',
  Documentation: 'SERVICE_FEES',
}

const expenseSystemKey: Record<string, string> = {
  Marketing: 'MARKETING_EXPENSE',
  'Facebook ads': 'MARKETING_EXPENSE',
  'Google ads': 'MARKETING_EXPENSE',
  Photography: 'MARKETING_EXPENSE',
  'Office rent': 'OFFICE_RENT_EXPENSE',
  Salary: 'SALARIES_EXPENSE',
  Transport: 'TRAVEL_EXPENSE',
  Travel: 'TRAVEL_EXPENSE',
  Utilities: 'UTILITIES_EXPENSE',
  Maintenance: 'MAINTENANCE_EXPENSE',
  Legal: 'LEGAL_FEES_EXPENSE',
  Software: 'SOFTWARE_EXPENSE',
  'Agent commission': 'COMMISSION_EXPENSE',
}

export const normalizeFinanceCategoryKey = (category: unknown) => String(category || '').trim().toLowerCase().replace(/\s+/g, ' ')

const actorObjectId = (actor: AccountingActor) => {
  if (!mongoose.isValidObjectId(actor.id)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(actor.id)
}

const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}

const expectedAccountType = (transactionType: FinanceCategoryMappingType) => transactionType === 'income' ? 'REVENUE' : 'EXPENSE'

const resolveFallbackSystemKey = (transactionType: FinanceCategoryMappingType, category: string) => {
  if (transactionType === 'income') return incomeSystemKey[category] || 'SERVICE_FEES'
  return expenseSystemKey[category] || 'GENERAL_OPERATING_EXPENSE'
}

const phase3ExpenseAccounts: Record<string, { code: string; name: string }> = {
  GENERAL_OPERATING_EXPENSE: { code: '5900', name: 'General Operating Expenses' },
  TRAVEL_EXPENSE: { code: '5710', name: 'Travel & Transport' },
  UTILITIES_EXPENSE: { code: '5720', name: 'Utilities' },
  MAINTENANCE_EXPENSE: { code: '5730', name: 'Maintenance' },
}

const ensurePhase3ExpenseAccount = async (organizationId: string, actor: AccountingActor, systemKey: string, session?: ClientSession) => {
  let account = await withSession(FinanceAccount.findOne({ organizationId, systemKey }), session).lean()
  if (account) return account
  const definition = phase3ExpenseAccounts[systemKey]
  if (!definition) throw new ApiError(httpStatus.CONFLICT, `Required accounting account ${systemKey} is not configured. Re-run accounting initialization.`)
  const parent = await withSession(FinanceAccount.findOne({ organizationId, systemKey: 'EXPENSES_ROOT' }), session).lean()
  if (!parent) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before configuring finance category mappings')
  const rows = await FinanceAccount.create([{
    organizationId,
    code: definition.code,
    name: definition.name,
    type: 'EXPENSE',
    parentAccountId: parent._id,
    normalBalance: 'DEBIT',
    currency: parent.currency,
    systemKey,
    isSystem: true,
    allowManualPosting: true,
    status: 'ACTIVE',
    createdBy: actorObjectId(actor),
  }], session ? { session } : undefined).catch(async (error: any) => {
    if (error?.code !== 11000) throw error
    const existing = await withSession(FinanceAccount.findOne({ organizationId, systemKey }), session).lean()
    if (!existing) throw error
    return [existing as any]
  })
  return rows[0]
}

const findSystemAccount = async (organizationId: string, systemKey: string, actor: AccountingActor, session?: ClientSession) => {
  if (phase3ExpenseAccounts[systemKey]) return ensurePhase3ExpenseAccount(organizationId, actor, systemKey, session)
  const account = await withSession(FinanceAccount.findOne({ organizationId, systemKey, status: 'ACTIVE' }), session).lean()
  if (!account) throw new ApiError(httpStatus.CONFLICT, `Required accounting account ${systemKey} is not configured. Re-run accounting initialization.`)
  return account
}

const ensureDefaults = async (organizationId: string, actor: AccountingActor, session?: ClientSession) => {
  const initialized = await withSession(FinanceAccount.exists({ organizationId, systemKey: 'ASSETS_ROOT' }), session)
  if (!initialized) return []
  const actorId = actorObjectId(actor)
  const operations: Array<Promise<unknown>> = []
  for (const category of FINANCE_OPERATIONAL_CATEGORIES) {
    for (const transactionType of ['income', 'expense'] as const) {
      const systemKey = resolveFallbackSystemKey(transactionType, category)
      const account = await findSystemAccount(organizationId, systemKey, actor, session)
      operations.push(FinanceCategoryAccountMapping.updateOne(
        { organizationId, transactionType, categoryKey: normalizeFinanceCategoryKey(category) },
        { $setOnInsert: { organizationId, transactionType, category, categoryKey: normalizeFinanceCategoryKey(category), accountId: account._id, isSystemDefault: true, createdBy: actorId } },
        { upsert: true, session, setDefaultsOnInsert: true },
      ))
    }
  }
  await Promise.all(operations)
  return list(organizationId, session)
}

const list = async (organizationId: string, session?: ClientSession) => {
  const query = FinanceCategoryAccountMapping.find({ organizationId }).sort({ category: 1, transactionType: 1 }).populate('accountId', 'code name type status').lean()
  if (session) query.session(session)
  return query
}

const listWithDefaults = async (organizationId: string, actor: AccountingActor, session?: ClientSession) => {
  await ensureDefaults(organizationId, actor, session)
  return list(organizationId, session)
}

const setMapping = async (organizationId: string, actor: AccountingActor, input: { transactionType: FinanceCategoryMappingType; category: string; accountId: string }, session?: ClientSession) => {
  const category = String(input.category || '').trim()
  if (!category) throw new ApiError(httpStatus.BAD_REQUEST, 'Category is required')
  if (!mongoose.isValidObjectId(input.accountId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid finance account id')
  const account = await withSession(FinanceAccount.findOne({ _id: input.accountId, organizationId, status: 'ACTIVE', allowManualPosting: true }), session).lean()
  if (!account) throw new ApiError(httpStatus.BAD_REQUEST, 'Selected finance account does not belong to this organization, is inactive, or does not allow direct posting')
  const expected = expectedAccountType(input.transactionType)
  if (account.type !== expected) throw new ApiError(httpStatus.BAD_REQUEST, `${input.transactionType === 'income' ? 'Income' : 'Expense'} categories must map to a ${expected.toLowerCase()} account`)
  const actorId = actorObjectId(actor)
  const before = await withSession(FinanceCategoryAccountMapping.findOne({ organizationId, transactionType: input.transactionType, categoryKey: normalizeFinanceCategoryKey(category) }), session).lean()
  const row = await FinanceCategoryAccountMapping.findOneAndUpdate(
    { organizationId, transactionType: input.transactionType, categoryKey: normalizeFinanceCategoryKey(category) },
    {
      $set: { category, accountId: account._id, isSystemDefault: false, updatedBy: actorId },
      $setOnInsert: { organizationId, transactionType: input.transactionType, categoryKey: normalizeFinanceCategoryKey(category), createdBy: actorId },
    },
    { upsert: true, new: true, runValidators: true, session, setDefaultsOnInsert: true },
  ).populate('accountId', 'code name type status')
  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role || 'tenant',
    action: 'finance.category_mapping_updated',
    entityType: 'financeCategoryAccountMapping',
    entityId: row?._id ? String(row._id) : undefined,
    reason: `Finance ${input.transactionType} category mapping updated`,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      transactionType: input.transactionType,
      category,
      previousAccountId: before?.accountId ? String(before.accountId) : null,
      accountId: String(account._id),
    },
  }, session)
  return row
}

const resolveAccount = async (organizationId: string, actor: AccountingActor, transactionType: FinanceCategoryMappingType, category: string, session?: ClientSession) => {
  const categoryKey = normalizeFinanceCategoryKey(category)
  let mapping = await withSession(FinanceCategoryAccountMapping.findOne({ organizationId, transactionType, categoryKey }), session).lean()
  if (!mapping) {
    const systemKey = resolveFallbackSystemKey(transactionType, category)
    const account = await findSystemAccount(organizationId, systemKey, actor, session)
    const actorId = actorObjectId(actor)
    mapping = await FinanceCategoryAccountMapping.findOneAndUpdate(
      { organizationId, transactionType, categoryKey },
      { $setOnInsert: { organizationId, transactionType, category, categoryKey, accountId: account._id, isSystemDefault: true, createdBy: actorId } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    ).lean()
  }
  if (!mapping) throw new ApiError(httpStatus.CONFLICT, `No GL mapping exists for ${transactionType} category ${category}`)
  const account = await withSession(FinanceAccount.findOne({ _id: mapping.accountId, organizationId, status: 'ACTIVE', type: expectedAccountType(transactionType), allowManualPosting: true }), session).lean()
  if (!account) throw new ApiError(httpStatus.CONFLICT, `The GL account mapped to ${category} is inactive or invalid`)
  return account
}

export const FinanceCategoryMappingService = { ensureDefaults, list, listWithDefaults, setMapping, resolveAccount }
