import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ExcelJS from 'exceljs'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { TenantReferenceService } from '../../shared/tenantReference.service'
import type { AccountingActor, FinanceJournalLineInput } from './financeAccounting.interface'
import { FinanceAccount, FinanceAccountingSequence, FinanceJournalLine } from './financeAccounting.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccountingService } from './financeAccounting.service'
import { AccountingPostingService } from './accountingPosting.service'
import { FinanceInvoice, FinanceVendor } from './finance.model'
import { moneyFromMinorUnits, moneyToMinorUnits } from './finance.money'
import {
  FinanceBankAccount, FinanceBankStatement, FinanceBankStatementLine, FinanceBankTransfer,
  FinanceClientDeposit, FinanceReconciliation, FinanceTaxCode, FinanceVendorBill,
} from './financeOperations.model'
import type { FinanceClientDepositStatus, FinanceTaxDirection } from './financeOperations.interface'
import { assertLegacyFinanceCurrency, FINANCE_ERROR_CODES, LEGACY_FINANCE_CURRENCY } from './finance.contract'

const actorObjectId = (actor: AccountingActor) => {
  const value = String(actor.id || '')
  if (!mongoose.isValidObjectId(value)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(value)
}
const objectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}
const dateValue = (value: unknown, label: string) => {
  const date = value instanceof Date ? new Date(value) : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return date
}
const inclusiveEnd = (value: unknown, label = 'end date') => {
  const raw = String(value || '').trim()
  const d = dateValue(value, label)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d.setUTCHours(23, 59, 59, 999)
  return d
}
const positiveMinor = (value: unknown, field: string) => {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(httpStatus.BAD_REQUEST, `${field} must be greater than zero`)
  return moneyToMinorUnits(amount, field)
}
const safeMinor = (value: unknown, field: string) => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${field} must be a non-negative integer minor-unit amount`)
  return amount
}
const audit = (organizationId: string, actor: AccountingActor, action: string, entityType: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) =>
  writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)
const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}
const nextNumber = async (organizationId: string, key: string, prefix: string, date: Date, session?: ClientSession) => {
  const year = date.getUTCFullYear()
  const row = await FinanceAccountingSequence.findOneAndUpdate(
    { organizationId, key: `${key}:${year}` },
    { $inc: { value: 1 }, $setOnInsert: { organizationId, key: `${key}:${year}` } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  ).lean()
  if (!row) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to generate ${key} number`)
  return `${prefix}-${year}-${String(row.value).padStart(6, '0')}`
}
const settings = async (organizationId: string, session?: ClientSession) => {
  const row = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  if (!row) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before using operational accounting', '', FINANCE_ERROR_CODES.notInitialized)
  assertLegacyFinanceCurrency(row.baseCurrency || LEGACY_FINANCE_CURRENCY, 'Organization accounting base currency')
  return row
}
const account = async (organizationId: string, value: unknown, types: string[], label: string, session?: ClientSession, requireDirectPosting = true) => {
  const row = await withSession(FinanceAccount.findOne({ _id: objectId(value, label), organizationId, status: 'ACTIVE' }), session).lean()
  if (!row) throw new ApiError(httpStatus.BAD_REQUEST, `${label} is invalid, inactive, or belongs to another organization`, '', FINANCE_ERROR_CODES.invalidAccountMapping)
  if (!types.includes(row.type)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be a ${types.join(' or ')} account`, '', FINANCE_ERROR_CODES.invalidAccountMapping)
  if (requireDirectPosting && !row.allowManualPosting) throw new ApiError(httpStatus.BAD_REQUEST, `${label} does not allow direct posting`, '', FINANCE_ERROR_CODES.invalidAccountMapping)
  return row
}
const bankAccount = async (organizationId: string, id: unknown, session?: ClientSession, active = true) => {
  const query: any = { _id: objectId(id, 'bank account id'), organizationId }
  if (active) query.status = 'ACTIVE'
  const row = await withSession(FinanceBankAccount.findOne(query), session).lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Bank account not found')
  return row
}
const taxCode = async (organizationId: string, id: unknown, direction?: FinanceTaxDirection, session?: ClientSession) => {
  if (!id) return null
  const row = await withSession(FinanceTaxCode.findOne({ _id: objectId(id, 'tax code id'), organizationId, status: 'ACTIVE' }), session).lean()
  if (!row) throw new ApiError(httpStatus.BAD_REQUEST, 'Tax code is invalid, inactive, or belongs to another organization')
  if (direction && row.direction !== direction) throw new ApiError(httpStatus.BAD_REQUEST, `Tax code must have ${direction} direction`)
  return row
}
const taxMinor = (baseMinor: number, rateBasisPoints: number) => Math.round((baseMinor * rateBasisPoints) / 10000)
const postedJournal = (organizationId: string, actor: AccountingActor, input: Parameters<typeof AccountingPostingService.postAutomatedInSession>[2], session?: ClientSession) =>
  AccountingPostingService.postAutomatedInSession(organizationId, { ...actor, system: true }, input, session)

const ensureDefaultBankAccount = async (organizationId: string, actor: AccountingActor, session?: ClientSession) => {
  const existing = await withSession(FinanceBankAccount.findOne({ organizationId, isDefaultOperating: true, status: 'ACTIVE' }), session).lean()
  if (existing) return existing
  const s = await settings(organizationId, session)
  if (!s.defaultAccounts?.bank) return null
  const gl = await account(organizationId, s.defaultAccounts.bank, ['ASSET'], 'default bank GL account', session)
  try {
    const rows = await FinanceBankAccount.create([{
      organizationId, name: 'Operating Bank', type: 'CHECKING', currency: s.baseCurrency, glAccountId: gl._id,
      isDefaultOperating: true, status: 'ACTIVE', createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    return rows[0].toObject()
  } catch (error: any) {
    if (error?.code === 11000) return withSession(FinanceBankAccount.findOne({ organizationId, glAccountId: gl._id }), session).lean()
    throw error
  }
}

const seedDefaultTaxCodes = async (organizationId: string, actor: AccountingActor, session?: ClientSession) => {
  const s = await settings(organizationId, session)
  const defaults = [
    { code: 'ZERO', name: 'Zero Rated', type: 'ZERO_RATED', direction: 'OUTPUT', rateBasisPoints: 0, outputAccountId: s.taxAccounts?.outputTax },
    { code: 'EXEMPT', name: 'Exempt', type: 'EXEMPT', direction: 'OUTPUT', rateBasisPoints: 0, outputAccountId: s.taxAccounts?.outputTax },
  ] as const
  for (const item of defaults) {
    await FinanceTaxCode.updateOne(
      { organizationId, code: item.code },
      { $setOnInsert: { organizationId, ...item, status: 'ACTIVE', isSystemDefault: true, createdBy: actorObjectId(actor) } },
      { upsert: true, session, setDefaultsOnInsert: true },
    )
  }
}

const initializeOperations = async (organizationId: string, actor: AccountingActor) => FinanceAccountingService.accountingTransaction(async (session) => {
  const bank = await ensureDefaultBankAccount(organizationId, actor, session)
  await seedDefaultTaxCodes(organizationId, actor, session)
  await audit(organizationId, actor, 'finance.operations_initialized', 'financeOperations', organizationId, 'Phase 4 operational accounting initialized', { defaultBankAccountId: bank?._id ? String(bank._id) : null }, session)
  return { defaultBankAccount: bank }
})

// ---------- Receivables ----------
const receivables = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const asOf = query.asOf ? inclusiveEnd(query.asOf, 'as of date') : new Date()
  const where: Record<string, any> = { organizationId, archivedAt: null, status: { $nin: ['draft', 'cancelled'] } }
  if (query.search) {
    const q = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    where.$or = [{ invoiceNumber: { $regex: q, $options: 'i' } }, { clientName: { $regex: q, $options: 'i' } }, { clientEmail: { $regex: q, $options: 'i' } }]
  }
  const rows: any[] = await FinanceInvoice.find(where).sort({ dueDate: 1, issueDate: 1 }).lean()
  const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 }
  const data = rows.map((invoice) => {
    const originalMinor = moneyToMinorUnits(Number(invoice.total || 0), 'invoice total')
    const paidMinor = moneyToMinorUnits(Number(invoice.paidAmount || 0), 'invoice paid amount')
    const outstandingMinor = Math.max(0, originalMinor - paidMinor)
    const due = invoice.dueDate ? new Date(invoice.dueDate) : new Date(invoice.issueDate)
    const daysOverdue = outstandingMinor > 0 && due < asOf ? Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86400000)) : 0
    if (outstandingMinor > 0) {
      if (daysOverdue === 0) buckets.current += outstandingMinor
      else if (daysOverdue <= 30) buckets.days1to30 += outstandingMinor
      else if (daysOverdue <= 60) buckets.days31to60 += outstandingMinor
      else if (daysOverdue <= 90) buckets.days61to90 += outstandingMinor
      else buckets.days90plus += outstandingMinor
    }
    return { _id: invoice._id, invoiceNumber: invoice.invoiceNumber, customer: { name: invoice.clientName, email: invoice.clientEmail, phone: invoice.clientPhone }, originalMinor, paidMinor, outstandingMinor, dueDate: invoice.dueDate, issueDate: invoice.issueDate, daysOverdue, status: invoice.status, propertyId: invoice.propertyId || null }
  }).filter((row) => query.includeSettled === 'true' || row.outstandingMinor > 0)
  return { data, aging: { ...buckets, total: Object.values(buckets).reduce((a, b) => a + b, 0) }, asOf }
}

// ---------- Tax codes ----------
const listTaxCodes = (organizationId: string) => FinanceTaxCode.find({ organizationId }).sort({ code: 1 }).populate('outputAccountId inputAccountId withholdingAccountId', 'code name type status').lean()
const createTaxCode = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session)
  const direction = String(input.direction).toUpperCase() as FinanceTaxDirection
  const type = String(input.type).toUpperCase()
  const ratePercent = Number(input.ratePercent || 0)
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Tax rate must be between 0 and 100 percent')
  if (['ZERO_RATED', 'EXEMPT'].includes(type) && ratePercent !== 0) throw new ApiError(httpStatus.BAD_REQUEST, `${type} tax codes must have a zero rate`)
  const outputAccountId = direction === 'OUTPUT' ? (input.outputAccountId || s.taxAccounts?.outputTax) : null
  const inputAccountId = direction === 'INPUT' ? (input.inputAccountId || s.taxAccounts?.inputTax) : null
  const withholdingAccountId = direction === 'WITHHOLDING' ? (input.withholdingAccountId || s.taxAccounts?.withholdingTax) : null
  if (direction === 'OUTPUT') await account(organizationId, outputAccountId, ['LIABILITY'], 'output tax account', session)
  if (direction === 'INPUT') await account(organizationId, inputAccountId, ['ASSET'], 'input tax account', session)
  if (direction === 'WITHHOLDING') await account(organizationId, withholdingAccountId, ['LIABILITY'], 'withholding tax account', session)
  let row: any
  try {
    const created = await FinanceTaxCode.create([{
      organizationId, code: String(input.code).trim().toUpperCase(), name: String(input.name).trim(), type, direction,
      rateBasisPoints: Math.round(ratePercent * 100), outputAccountId, inputAccountId, withholdingAccountId,
      status: input.status || 'ACTIVE', isSystemDefault: false, createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    row = created[0]
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'A tax code with this code already exists')
    throw error
  }
  await audit(organizationId, actor, 'finance.tax_code_created', 'financeTaxCode', String(row._id), 'Tax code created', { code: row.code, direction, ratePercent }, session)
  return row.toObject()
})
const updateTaxCode = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceTaxCode.findOne({ _id: objectId(id, 'tax code id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Tax code not found')
  if (row.isSystemDefault && (input.code !== undefined || input.type !== undefined || input.direction !== undefined)) throw new ApiError(httpStatus.CONFLICT, 'System tax code identity is protected')
  if (input.ratePercent !== undefined) {
    const rate = Number(input.ratePercent)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Tax rate must be between 0 and 100 percent')
    if (['ZERO_RATED', 'EXEMPT'].includes(input.type || row.type) && rate !== 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Zero-rated/exempt codes must have a zero rate')
    row.rateBasisPoints = Math.round(rate * 100)
  }
  for (const key of ['name', 'status'] as const) if (input[key] !== undefined) row[key] = input[key]
  row.updatedBy = actorObjectId(actor)
  await row.save({ session })
  await audit(organizationId, actor, 'finance.tax_code_updated', 'financeTaxCode', String(row._id), 'Tax code updated', { status: row.status }, session)
  return row.toObject()
})

// ---------- Bank accounts ----------
const listBankAccounts = async (organizationId: string) => {
  const rows: any[] = await FinanceBankAccount.find({ organizationId }).sort({ isDefaultOperating: -1, name: 1 }).populate('glAccountId', 'code name type normalBalance status').lean()
  return Promise.all(rows.map(async (row) => ({ ...row, ledgerBalanceMinor: await glBalanceMinor(organizationId, (row.glAccountId as any)?._id || row.glAccountId, new Date()) })))
}
const createBankAccount = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session)
  const type = String(input.type).toUpperCase()
  const allowedTypes = type === 'CREDIT_CARD' ? ['LIABILITY'] : ['ASSET']
  const gl = await account(organizationId, input.glAccountId, allowedTypes, 'bank GL account', session)
  if (String(gl.currency).toUpperCase() !== String(s.baseCurrency).toUpperCase()) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank account GL currency must match base currency', '', FINANCE_ERROR_CODES.currencyMismatch)
  if (input.isDefaultOperating) await FinanceBankAccount.updateMany({ organizationId, isDefaultOperating: true }, { $set: { isDefaultOperating: false, updatedBy: actorObjectId(actor) } }, { session })
  let row: any
  try {
    const rows = await FinanceBankAccount.create([{
      organizationId, name: String(input.name).trim(), type, bankName: input.bankName || '', accountName: input.accountName || '',
      accountNumberMasked: input.accountNumberMasked || '', currency: s.baseCurrency, glAccountId: gl._id,
      isDefaultOperating: Boolean(input.isDefaultOperating), status: input.status || 'ACTIVE', createdBy: actorObjectId(actor),
    }], session ? { session } : undefined)
    row = rows[0]
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'Bank account name or linked GL account is already in use')
    throw error
  }
  await audit(organizationId, actor, 'finance.bank_account_created', 'financeBankAccount', String(row._id), 'Bank account created', { name: row.name, glAccountId: String(row.glAccountId) }, session)
  return row.toObject()
})
const updateBankAccount = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceBankAccount.findOne({ _id: objectId(id, 'bank account id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Bank account not found')
  const nextType = String(input.type || row.type).toUpperCase()
  const typeChanged = input.type !== undefined && nextType !== String(row.type).toUpperCase()
  const glChanged = input.glAccountId !== undefined && String(input.glAccountId) !== String(row.glAccountId)
  if (typeChanged || glChanged) {
    const used = await withSession(FinanceJournalLine.exists({ organizationId, accountId: row.glAccountId }), session)
    if (used && (typeChanged || glChanged)) throw new ApiError(httpStatus.CONFLICT, 'Bank type/GL account cannot be changed after ledger activity exists')
    const candidateGlAccountId = glChanged ? input.glAccountId : row.glAccountId
    const validatedGl = await account(organizationId, candidateGlAccountId, nextType === 'CREDIT_CARD' ? ['LIABILITY'] : ['ASSET'], 'bank GL account', session)
    row.glAccountId = validatedGl._id
  }
  if (input.status === 'INACTIVE') {
    const openStatement = await withSession(FinanceBankStatement.exists({ organizationId, bankAccountId: row._id, status: 'OPEN' }), session)
    if (openStatement) throw new ApiError(httpStatus.CONFLICT, 'Reconcile or remove open bank statements before deactivating this bank account')
  }
  if (input.isDefaultOperating) await FinanceBankAccount.updateMany({ organizationId, _id: { $ne: row._id }, isDefaultOperating: true }, { $set: { isDefaultOperating: false, updatedBy: actorObjectId(actor) } }, { session })
  for (const key of ['name', 'type', 'bankName', 'accountName', 'accountNumberMasked', 'status', 'isDefaultOperating'] as const) if (input[key] !== undefined) row[key] = input[key]
  row.updatedBy = actorObjectId(actor)
  await row.save({ session })
  await audit(organizationId, actor, 'finance.bank_account_updated', 'financeBankAccount', String(row._id), 'Bank account updated', { status: row.status, isDefaultOperating: row.isDefaultOperating }, session)
  return row.toObject()
})
const transferBankFunds = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const source = await bankAccount(organizationId, input.sourceBankAccountId, session)
  const destination = await bankAccount(organizationId, input.destinationBankAccountId, session)
  if (String(source._id) === String(destination._id)) throw new ApiError(httpStatus.BAD_REQUEST, 'Source and destination bank accounts must be different')
  if (source.currency !== destination.currency) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank transfer accounts must use the same currency', '', FINANCE_ERROR_CODES.currencyMismatch)
  const amountMinor = positiveMinor(input.amount, 'transfer amount')
  const transferDate = dateValue(input.transferDate || new Date(), 'transfer date')
  const transferNumber = await nextNumber(organizationId, 'bank-transfer', 'TRF', transferDate, session)
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'BANK_TRANSFER', sourceId: transferNumber, idempotencyKey: `BANK_TRANSFER:${transferNumber}`,
    entryDate: transferDate, postingDate: transferDate, description: input.description || `Bank transfer ${transferNumber}`, reference: input.reference || transferNumber,
    currency: source.currency,
    lines: [
      { accountId: String(destination.glAccountId), debitMinor: amountMinor, description: transferNumber },
      { accountId: String(source.glAccountId), creditMinor: amountMinor, description: transferNumber },
    ],
  }, session)
  const rows = await FinanceBankTransfer.create([{
    organizationId, transferNumber, sourceBankAccountId: source._id, destinationBankAccountId: destination._id, amountMinor,
    currency: source.currency, transferDate, reference: input.reference || '', description: input.description || '', journalEntryId: journal._id,
    createdBy: actorObjectId(actor),
  }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.bank_transfer_posted', 'financeBankTransfer', String(rows[0]._id), 'Bank transfer posted', { transferNumber, amountMinor, journalEntryId: String(journal._id) }, session)
  return rows[0].toObject()
})
const listBankTransfers = (organizationId: string) => FinanceBankTransfer.find({ organizationId }).sort({ transferDate: -1, createdAt: -1 }).populate('sourceBankAccountId destinationBankAccountId', 'name type').lean()

const glBalanceMinor = async (organizationId: string, glAccountId: unknown, asOf: Date) => {
  const gl = await FinanceAccount.findOne({ _id: glAccountId, organizationId }).select('normalBalance').lean()
  if (!gl) throw new ApiError(httpStatus.NOT_FOUND, 'Linked GL account not found')
  const end = new Date(asOf); end.setUTCHours(23, 59, 59, 999)
  const rows = await FinanceJournalLine.aggregate([
    { $match: { organizationId, accountId: new mongoose.Types.ObjectId(String(glAccountId)), journalStatus: { $in: ['POSTED', 'REVERSED'] }, postingDate: { $lte: end } } },
    { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } },
  ])
  const signed = Number(rows[0]?.debit || 0) - Number(rows[0]?.credit || 0)
  return gl.normalBalance === 'DEBIT' ? signed : -signed
}

// ---------- Vendor bills / payables ----------
const computeVendorBill = async (organizationId: string, input: Record<string, any>, session?: ClientSession) => {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor bill requires at least one line')
  const lines = [] as any[]
  let subtotalMinor = 0
  for (const item of input.lines) {
    const gl = await account(organizationId, item.accountId, ['ASSET', 'EXPENSE'], 'vendor bill line account', session)
    const amountMinor = item.amountMinor !== undefined ? safeMinor(item.amountMinor, 'line amount') : positiveMinor(item.amount, 'line amount')
    if (item.propertyId) await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, item.propertyId, session)
    subtotalMinor += amountMinor
    lines.push({ description: String(item.description || gl.name).trim(), accountId: gl._id, amountMinor, propertyId: item.propertyId ? objectId(item.propertyId, 'property id') : null })
  }
  const tax = input.taxCodeId ? await taxCode(organizationId, input.taxCodeId, undefined, session) : null
  if (tax?.direction === 'OUTPUT') throw new ApiError(httpStatus.BAD_REQUEST, 'Output tax codes cannot be used on vendor bills')
  const taxAmountMinor = tax ? taxMinor(subtotalMinor, tax.rateBasisPoints) : 0
  const totalMinor = tax?.direction === 'WITHHOLDING' ? Math.max(0, subtotalMinor - taxAmountMinor) : subtotalMinor + taxAmountMinor
  return { lines, subtotalMinor, tax, taxAmountMinor, totalMinor }
}
const createVendorBill = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  await withSession(FinanceVendor.findOne({ _id: objectId(input.vendorId, 'vendor id'), organizationId, status: 'active' }), session).lean().then((v) => { if (!v) throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor is invalid or inactive') })
  if (input.propertyId) await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, input.propertyId, session)
  const s = await settings(organizationId, session)
  const calculated = await computeVendorBill(organizationId, input, session)
  const billDate = dateValue(input.billDate || new Date(), 'bill date')
  const billNumber = await nextNumber(organizationId, 'vendor-bill', 'BILL', billDate, session)
  const rows = await FinanceVendorBill.create([{
    organizationId, billNumber, vendorId: objectId(input.vendorId, 'vendor id'), vendorInvoiceNumber: input.vendorInvoiceNumber || '', billDate,
    dueDate: input.dueDate ? dateValue(input.dueDate, 'due date') : null, currency: s.baseCurrency, lines: calculated.lines,
    subtotalMinor: calculated.subtotalMinor, taxCodeId: calculated.tax?._id || null, taxAmountMinor: calculated.taxAmountMinor,
    totalMinor: calculated.totalMinor, paidMinor: 0, status: 'DRAFT', notes: input.notes || '', propertyId: input.propertyId ? objectId(input.propertyId, 'property id') : null,
    postingJournalId: null, accountingVersion: 0, payments: [], createdBy: actorObjectId(actor),
  }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.vendor_bill_created', 'financeVendorBill', String(rows[0]._id), 'Vendor bill draft created', { billNumber }, session)
  return rows[0].toObject()
})
const listVendorBills = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const where: Record<string, any> = { organizationId }
  if (query.status) where.status = String(query.status).toUpperCase()
  if (query.vendorId) where.vendorId = objectId(query.vendorId, 'vendor id')
  return FinanceVendorBill.find(where).sort({ billDate: -1, createdAt: -1 }).populate('vendorId', 'name category status').populate('lines.accountId', 'code name type').populate('taxCodeId', 'code name rateBasisPoints direction').lean()
}
const getVendorBill = async (organizationId: string, id: string, session?: ClientSession) => {
  const query = FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }).populate('vendorId', 'name category status').populate('lines.accountId', 'code name type').populate('taxCodeId', 'code name rateBasisPoints direction')
  if (session) query.session(session)
  const row = await query.lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  return row
}
const updateVendorBill = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  if (row.status !== 'DRAFT') throw new ApiError(httpStatus.CONFLICT, 'Only draft vendor bills can be edited')
  const merged = { ...row.toObject(), ...input, lines: input.lines || row.lines.map((line: any) => ({ ...line.toObject(), accountId: String(line.accountId), amountMinor: line.amountMinor })) }
  const calculated = await computeVendorBill(organizationId, merged, session)
  if (input.vendorId) {
    const vendor = await withSession(FinanceVendor.findOne({ _id: objectId(input.vendorId, 'vendor id'), organizationId, status: 'active' }), session).lean()
    if (!vendor) throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor is invalid or inactive')
    row.vendorId = vendor._id
  }
  if (input.propertyId !== undefined) { if (input.propertyId) await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, input.propertyId, session); row.propertyId = input.propertyId ? objectId(input.propertyId, 'property id') : null }
  row.lines = calculated.lines; row.subtotalMinor = calculated.subtotalMinor; row.taxCodeId = calculated.tax?._id || null; row.taxAmountMinor = calculated.taxAmountMinor; row.totalMinor = calculated.totalMinor
  if (input.vendorInvoiceNumber !== undefined) row.vendorInvoiceNumber = input.vendorInvoiceNumber
  if (input.billDate !== undefined) row.billDate = dateValue(input.billDate, 'bill date')
  if (input.dueDate !== undefined) row.dueDate = input.dueDate ? dateValue(input.dueDate, 'due date') : null
  if (input.notes !== undefined) row.notes = input.notes
  row.updatedBy = actorObjectId(actor)
  await row.save({ session })
  await audit(organizationId, actor, 'finance.vendor_bill_updated', 'financeVendorBill', String(row._id), 'Vendor bill draft updated', { billNumber: row.billNumber }, session)
  return getVendorBill(organizationId, id, session)
})
const approveVendorBill = async (organizationId: string, actor: AccountingActor, id: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  if (row.status !== 'DRAFT') throw new ApiError(httpStatus.CONFLICT, 'Only draft vendor bills can be approved')
  row.status = 'APPROVED'; row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.vendor_bill_approved', 'financeVendorBill', String(row._id), 'Vendor bill approved', { billNumber: row.billNumber }, session)
  return row.toObject()
})
const postVendorBill = async (organizationId: string, actor: AccountingActor, id: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  if (row.status !== 'APPROVED') throw new ApiError(httpStatus.CONFLICT, 'Only approved vendor bills can be posted')
  const s = await settings(organizationId, session)
  const ap = await account(organizationId, s.defaultAccounts?.accountsPayable, ['LIABILITY'], 'Accounts Payable account', session)
  const lines: FinanceJournalLineInput[] = row.lines.map((line: any) => ({ accountId: String(line.accountId), debitMinor: line.amountMinor, description: line.description, vendorId: String(row.vendorId), propertyId: line.propertyId ? String(line.propertyId) : row.propertyId ? String(row.propertyId) : null }))
  const tax = row.taxCodeId ? await taxCode(organizationId, row.taxCodeId, undefined, session) : null
  if (tax && row.taxAmountMinor > 0) {
    if (tax.direction === 'INPUT') {
      const taxAccount = await account(organizationId, tax.inputAccountId || s.taxAccounts?.inputTax, ['ASSET'], 'Input tax account', session)
      lines.push({ accountId: String(taxAccount._id), debitMinor: row.taxAmountMinor, description: `${tax.code} input tax`, vendorId: String(row.vendorId), propertyId: row.propertyId ? String(row.propertyId) : null })
    } else if (tax.direction === 'WITHHOLDING') {
      const withholding = await account(organizationId, tax.withholdingAccountId || s.taxAccounts?.withholdingTax, ['LIABILITY'], 'Withholding tax account', session)
      lines.push({ accountId: String(withholding._id), creditMinor: row.taxAmountMinor, description: `${tax.code} withholding`, vendorId: String(row.vendorId), propertyId: row.propertyId ? String(row.propertyId) : null })
    }
  }
  lines.push({ accountId: String(ap._id), creditMinor: row.totalMinor, description: row.billNumber, vendorId: String(row.vendorId), propertyId: row.propertyId ? String(row.propertyId) : null })
  const version = Number(row.accountingVersion || 0) + 1
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'VENDOR_BILL', sourceId: `${row._id}:v${version}`, idempotencyKey: `VENDOR_BILL:${row._id}:v${version}`,
    entryDate: row.billDate, postingDate: row.billDate, description: `Vendor bill ${row.billNumber}`, reference: row.vendorInvoiceNumber || row.billNumber,
    currency: row.currency, lines,
  }, session)
  row.postingJournalId = journal._id; row.accountingVersion = version; row.status = 'POSTED'; row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.vendor_bill_posted', 'financeVendorBill', String(row._id), 'Vendor bill posted to Accounts Payable', { billNumber: row.billNumber, journalEntryId: String(journal._id) }, session)
  return getVendorBill(organizationId, id, session)
})
const payVendorBill = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  if (!['POSTED', 'PARTIALLY_PAID'].includes(row.status)) throw new ApiError(httpStatus.CONFLICT, 'Only posted vendor bills can be paid')
  const amountMinor = positiveMinor(input.amount, 'payment amount')
  const outstanding = Number(row.totalMinor) - Number(row.paidMinor)
  if (amountMinor > outstanding) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment cannot exceed vendor bill outstanding balance')
  const bank = await bankAccount(organizationId, input.bankAccountId, session)
  if (bank.currency !== row.currency) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank account currency must match vendor bill currency', '', FINANCE_ERROR_CODES.currencyMismatch)
  const s = await settings(organizationId, session)
  const ap = await account(organizationId, s.defaultAccounts?.accountsPayable, ['LIABILITY'], 'Accounts Payable account', session)
  const paidAt = dateValue(input.paidAt || new Date(), 'payment date')
  const paymentId = new mongoose.Types.ObjectId()
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'VENDOR_BILL_PAYMENT', sourceId: String(paymentId), idempotencyKey: `VENDOR_BILL_PAYMENT:${paymentId}`,
    entryDate: paidAt, postingDate: paidAt, description: `Payment for ${row.billNumber}`, reference: input.reference || row.billNumber, currency: row.currency,
    lines: [
      { accountId: String(ap._id), debitMinor: amountMinor, description: row.billNumber, vendorId: String(row.vendorId), propertyId: row.propertyId ? String(row.propertyId) : null },
      { accountId: String(bank.glAccountId), creditMinor: amountMinor, description: row.billNumber, vendorId: String(row.vendorId), propertyId: row.propertyId ? String(row.propertyId) : null },
    ],
  }, session)
  row.payments.push({ _id: paymentId, amountMinor, paidAt, bankAccountId: bank._id, reference: input.reference || '', notes: input.notes || '', journalEntryId: journal._id, recordedBy: actorObjectId(actor) })
  row.paidMinor = Number(row.paidMinor) + amountMinor
  row.status = row.paidMinor >= row.totalMinor ? 'PAID' : 'PARTIALLY_PAID'
  row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.vendor_bill_payment_posted', 'financeVendorBill', String(row._id), 'Vendor bill payment posted', { billNumber: row.billNumber, amountMinor, journalEntryId: String(journal._id) }, session)
  return getVendorBill(organizationId, id, session)
})
const voidVendorBill = async (organizationId: string, actor: AccountingActor, id: string, reason: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceVendorBill.findOne({ _id: objectId(id, 'vendor bill id'), organizationId }), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor bill not found')
  if (row.status === 'VOID') return row.toObject()
  if (Number(row.paidMinor) > 0) throw new ApiError(httpStatus.CONFLICT, 'Paid or partially paid vendor bills cannot be voided')
  if (row.postingJournalId) await FinanceAccountingService.reverseJournalInternal(organizationId, actor, String(row.postingJournalId), { reason, reversalDate: new Date() }, session)
  row.status = 'VOID'; row.voidedAt = new Date(); row.voidedBy = actorObjectId(actor); row.voidReason = reason; row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.vendor_bill_voided', 'financeVendorBill', String(row._id), reason, { billNumber: row.billNumber }, session)
  return row.toObject()
})
const payables = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const asOf = query.asOf ? inclusiveEnd(query.asOf, 'as of date') : new Date()
  const rows: any[] = await FinanceVendorBill.find({ organizationId, status: { $in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } }).populate('vendorId', 'name category').sort({ dueDate: 1, billDate: 1 }).lean()
  const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 }
  const data = rows.map((bill) => {
    const outstandingMinor = Math.max(0, Number(bill.totalMinor) - Number(bill.paidMinor))
    const due = bill.dueDate ? new Date(bill.dueDate) : new Date(bill.billDate)
    const daysOverdue = outstandingMinor > 0 && due < asOf ? Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86400000)) : 0
    if (outstandingMinor > 0) {
      if (!daysOverdue) buckets.current += outstandingMinor
      else if (daysOverdue <= 30) buckets.days1to30 += outstandingMinor
      else if (daysOverdue <= 60) buckets.days31to60 += outstandingMinor
      else if (daysOverdue <= 90) buckets.days61to90 += outstandingMinor
      else buckets.days90plus += outstandingMinor
    }
    return { _id: bill._id, billNumber: bill.billNumber, vendor: bill.vendorId, originalMinor: bill.totalMinor, paidMinor: bill.paidMinor, outstandingMinor, dueDate: bill.dueDate, billDate: bill.billDate, daysOverdue, status: bill.status }
  }).filter((row) => query.includeSettled === 'true' || row.outstandingMinor > 0)
  return { data, aging: { ...buckets, total: Object.values(buckets).reduce((a, b) => a + b, 0) }, asOf }
}

// ---------- Client deposits ----------
const depositStatus = (amount: number, applied: number, refunded: number): FinanceClientDepositStatus => {
  const remaining = Math.max(0, amount - applied - refunded)
  if (remaining === 0 && applied === amount) return 'APPLIED'
  if (remaining === 0 && refunded === amount) return 'REFUNDED'
  if (applied > 0) return 'PARTIALLY_APPLIED'
  if (refunded > 0) return 'PARTIALLY_REFUNDED'
  return 'OPEN'
}
const createClientDeposit = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session)
  const bank = await bankAccount(organizationId, input.bankAccountId, session)
  const liability = await account(organizationId, s.defaultAccounts?.clientDeposit, ['LIABILITY'], 'Client deposit liability account', session)
  if (input.propertyId) await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, input.propertyId, session)
  if (input.leadId) await TenantReferenceService.assertLeadBelongsToOrganization(organizationId, input.leadId, session)
  const amountMinor = positiveMinor(input.amount, 'deposit amount')
  const receivedAt = dateValue(input.receivedAt || new Date(), 'received date')
  const depositNumber = await nextNumber(organizationId, 'client-deposit', 'DEP', receivedAt, session)
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'CLIENT_DEPOSIT_RECEIPT', sourceId: depositNumber, idempotencyKey: `CLIENT_DEPOSIT_RECEIPT:${depositNumber}`,
    entryDate: receivedAt, postingDate: receivedAt, description: `Client deposit ${depositNumber}`, reference: input.reference || depositNumber, currency: s.baseCurrency,
    lines: [
      { accountId: String(bank.glAccountId), debitMinor: amountMinor, description: input.clientName, propertyId: input.propertyId || null },
      { accountId: String(liability._id), creditMinor: amountMinor, description: input.clientName, propertyId: input.propertyId || null },
    ],
  }, session)
  const rows = await FinanceClientDeposit.create([{
    organizationId, depositNumber, type: String(input.type).toUpperCase(), clientName: String(input.clientName).trim(), clientEmail: input.clientEmail || '', clientPhone: input.clientPhone || '',
    leadId: input.leadId ? objectId(input.leadId, 'lead id') : null, propertyId: input.propertyId ? objectId(input.propertyId, 'property id') : null, bankAccountId: bank._id,
    amountMinor, appliedMinor: 0, refundedMinor: 0, currency: s.baseCurrency, receivedAt, reference: input.reference || '', notes: input.notes || '', status: 'OPEN', receiptJournalId: journal._id,
    applications: [], refunds: [], createdBy: actorObjectId(actor),
  }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.client_deposit_received', 'financeClientDeposit', String(rows[0]._id), 'Client deposit received as liability', { depositNumber, amountMinor, journalEntryId: String(journal._id) }, session)
  return rows[0].toObject()
})
const listClientDeposits = (organizationId: string, query: Record<string, unknown> = {}) => {
  const where: Record<string, any> = { organizationId }
  if (query.status) where.status = String(query.status).toUpperCase()
  if (query.type) where.type = String(query.type).toUpperCase()
  return FinanceClientDeposit.find(where).sort({ receivedAt: -1, createdAt: -1 }).populate('bankAccountId', 'name type').lean()
}
const applyClientDeposit = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const deposit: any = await withSession(FinanceClientDeposit.findOne({ _id: objectId(id, 'deposit id'), organizationId }), session)
  if (!deposit) throw new ApiError(httpStatus.NOT_FOUND, 'Client deposit not found')
  if (['APPLIED', 'REFUNDED', 'CANCELLED'].includes(deposit.status)) throw new ApiError(httpStatus.CONFLICT, `Cannot apply a ${deposit.status.toLowerCase()} deposit`)
  const invoice: any = await withSession(FinanceInvoice.findOne({ _id: objectId(input.invoiceId, 'invoice id'), organizationId, archivedAt: null }), session)
  if (!invoice || !['sent', 'partial', 'overdue'].includes(invoice.status)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice is invalid or cannot receive a deposit allocation')
  const amountMinor = positiveMinor(input.amount, 'application amount')
  const available = Number(deposit.amountMinor) - Number(deposit.appliedMinor) - Number(deposit.refundedMinor)
  const totalMinor = moneyToMinorUnits(Number(invoice.total || 0), 'invoice total')
  const paidMinor = moneyToMinorUnits(Number(invoice.paidAmount || 0), 'invoice paid amount')
  const outstanding = Math.max(0, totalMinor - paidMinor)
  if (amountMinor > available) throw new ApiError(httpStatus.BAD_REQUEST, 'Application exceeds available deposit balance')
  if (amountMinor > outstanding) throw new ApiError(httpStatus.BAD_REQUEST, 'Application exceeds invoice outstanding balance')
  const s = await settings(organizationId, session)
  const liability = await account(organizationId, s.defaultAccounts?.clientDeposit, ['LIABILITY'], 'Client deposit liability account', session)
  const ar = await account(organizationId, s.defaultAccounts?.accountsReceivable, ['ASSET'], 'Accounts Receivable account', session)
  const applicationId = new mongoose.Types.ObjectId()
  const appliedAt = dateValue(input.appliedAt || new Date(), 'application date')
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'CLIENT_DEPOSIT_APPLICATION', sourceId: String(applicationId), idempotencyKey: `CLIENT_DEPOSIT_APPLICATION:${applicationId}`,
    entryDate: appliedAt, postingDate: appliedAt, description: `Apply ${deposit.depositNumber} to ${invoice.invoiceNumber}`, reference: deposit.depositNumber, currency: deposit.currency,
    lines: [
      { accountId: String(liability._id), debitMinor: amountMinor, description: deposit.depositNumber, propertyId: deposit.propertyId ? String(deposit.propertyId) : null },
      { accountId: String(ar._id), creditMinor: amountMinor, description: invoice.invoiceNumber, propertyId: invoice.propertyId ? String(invoice.propertyId) : null },
    ],
  }, session)
  deposit.applications.push({ _id: applicationId, invoiceId: invoice._id, amountMinor, appliedAt, journalEntryId: journal._id, appliedBy: actorObjectId(actor) })
  deposit.appliedMinor = Number(deposit.appliedMinor) + amountMinor
  deposit.status = depositStatus(deposit.amountMinor, deposit.appliedMinor, deposit.refundedMinor)
  deposit.updatedBy = actorObjectId(actor)
  await deposit.save({ session })
  invoice.payments.push({ amount: moneyFromMinorUnits(amountMinor), paidAt: appliedAt, paymentMethod: 'other', reference: deposit.depositNumber, notes: `Applied client deposit ${deposit.depositNumber}`, recordedBy: actorObjectId(actor), journalEntryId: journal._id })
  const nextPaid = paidMinor + amountMinor
  invoice.paidAmount = moneyFromMinorUnits(nextPaid)
  invoice.status = nextPaid >= totalMinor ? 'paid' : 'partial'
  invoice.updatedBy = actorObjectId(actor)
  await invoice.save({ session })
  await audit(organizationId, actor, 'finance.client_deposit_applied', 'financeClientDeposit', String(deposit._id), 'Client deposit applied to Accounts Receivable', { depositNumber: deposit.depositNumber, invoiceNumber: invoice.invoiceNumber, amountMinor, journalEntryId: String(journal._id) }, session)
  return deposit.toObject()
})
const refundClientDeposit = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const deposit: any = await withSession(FinanceClientDeposit.findOne({ _id: objectId(id, 'deposit id'), organizationId }), session)
  if (!deposit) throw new ApiError(httpStatus.NOT_FOUND, 'Client deposit not found')
  if (['APPLIED', 'REFUNDED', 'CANCELLED'].includes(deposit.status)) throw new ApiError(httpStatus.CONFLICT, `Cannot refund a ${deposit.status.toLowerCase()} deposit`)
  const amountMinor = positiveMinor(input.amount, 'refund amount')
  const available = Number(deposit.amountMinor) - Number(deposit.appliedMinor) - Number(deposit.refundedMinor)
  if (amountMinor > available) throw new ApiError(httpStatus.BAD_REQUEST, 'Refund exceeds available deposit balance')
  const bank = await bankAccount(organizationId, input.bankAccountId || deposit.bankAccountId, session)
  const s = await settings(organizationId, session)
  const liability = await account(organizationId, s.defaultAccounts?.clientDeposit, ['LIABILITY'], 'Client deposit liability account', session)
  const refundId = new mongoose.Types.ObjectId()
  const refundedAt = dateValue(input.refundedAt || new Date(), 'refund date')
  const journal: any = await postedJournal(organizationId, actor, {
    sourceType: 'CLIENT_DEPOSIT_REFUND', sourceId: String(refundId), idempotencyKey: `CLIENT_DEPOSIT_REFUND:${refundId}`,
    entryDate: refundedAt, postingDate: refundedAt, description: `Refund ${deposit.depositNumber}`, reference: input.reference || deposit.depositNumber, currency: deposit.currency,
    lines: [
      { accountId: String(liability._id), debitMinor: amountMinor, description: deposit.depositNumber, propertyId: deposit.propertyId ? String(deposit.propertyId) : null },
      { accountId: String(bank.glAccountId), creditMinor: amountMinor, description: deposit.depositNumber, propertyId: deposit.propertyId ? String(deposit.propertyId) : null },
    ],
  }, session)
  deposit.refunds.push({ _id: refundId, amountMinor, refundedAt, bankAccountId: bank._id, reference: input.reference || '', journalEntryId: journal._id, refundedBy: actorObjectId(actor) })
  deposit.refundedMinor = Number(deposit.refundedMinor) + amountMinor
  deposit.status = depositStatus(deposit.amountMinor, deposit.appliedMinor, deposit.refundedMinor)
  deposit.updatedBy = actorObjectId(actor); await deposit.save({ session })
  await audit(organizationId, actor, 'finance.client_deposit_refunded', 'financeClientDeposit', String(deposit._id), 'Client deposit refunded', { depositNumber: deposit.depositNumber, amountMinor, journalEntryId: String(journal._id) }, session)
  return deposit.toObject()
})

// ---------- Bank statements and reconciliation ----------
type ParsedStatementLine = { transactionDate: Date; description: string; reference: string; amountMinor: number }
const parseCsvRow = (line: string) => {
  const cells: string[] = []; let current = ''; let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1 } else quoted = !quoted }
    else if (c === ',' && !quoted) { cells.push(current); current = '' } else current += c
  }
  cells.push(current); return cells.map((cell) => cell.trim())
}
const normalizeStatementRows = (rows: string[][]): ParsedStatementLine[] => {
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const index = (names: string[]) => names.map((name) => headers.indexOf(name)).find((i) => i >= 0) ?? -1
  const dateIndex = index(['date', 'transaction_date', 'posted_date'])
  const descriptionIndex = index(['description', 'details', 'memo', 'narration'])
  const referenceIndex = index(['reference', 'ref', 'transaction_id'])
  const amountIndex = index(['amount', 'signed_amount'])
  const debitIndex = index(['debit', 'withdrawal'])
  const creditIndex = index(['credit', 'deposit'])
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Statement file requires date, description, and amount or debit/credit columns')
  const parsed: ParsedStatementLine[] = []
  rows.slice(1).forEach((row, offset) => {
    if (!row.some((cell) => String(cell || '').trim())) return
    const transactionDate = dateValue(row[dateIndex], `statement row ${offset + 2} date`)
    let amount = amountIndex >= 0 ? Number(String(row[amountIndex] || '').replace(/[,\s]/g, '')) : NaN
    if (!Number.isFinite(amount)) {
      const debit = debitIndex >= 0 ? Number(String(row[debitIndex] || '0').replace(/[,\s]/g, '')) || 0 : 0
      const credit = creditIndex >= 0 ? Number(String(row[creditIndex] || '0').replace(/[,\s]/g, '')) || 0 : 0
      amount = credit - debit
    }
    if (!Number.isFinite(amount) || amount === 0) throw new ApiError(httpStatus.BAD_REQUEST, `Statement row ${offset + 2} has an invalid zero/amount value`)
    parsed.push({ transactionDate, description: String(row[descriptionIndex] || '').trim() || 'Bank statement transaction', reference: referenceIndex >= 0 ? String(row[referenceIndex] || '').trim() : '', amountMinor: moneyToMinorUnits(amount, `statement row ${offset + 2} amount`) })
  })
  return parsed
}
const parseStatementFile = async (file: Express.Multer.File): Promise<ParsedStatementLine[]> => {
  const name = file.originalname.toLowerCase()
  if (name.endsWith('.csv') || file.mimetype.includes('csv')) {
    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '')
    return normalizeStatementRows(text.split(/\r?\n/).filter(Boolean).map(parseCsvRow))
  }
  if (name.endsWith('.xlsx') || file.mimetype.includes('spreadsheet')) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.buffer as any)
    const sheet = workbook.worksheets[0]
    if (!sheet) return []
    const rows: string[][] = []
    sheet.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as any[]).slice(1).map((value) => value instanceof Date ? value.toISOString() : String(value ?? ''))))
    return normalizeStatementRows(rows)
  }
  throw new ApiError(httpStatus.BAD_REQUEST, 'Only CSV and XLSX bank statements are supported')
}
const createBankStatement = async (organizationId: string, actor: AccountingActor, input: Record<string, any>, file: Express.Multer.File) => FinanceAccountingService.accountingTransaction(async (session) => {
  const bank = await bankAccount(organizationId, input.bankAccountId, session)
  const startDate = dateValue(input.startDate, 'statement start date'); const endDate = inclusiveEnd(input.endDate, 'statement end date')
  if (endDate < startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'Statement end date must be after start date')
  const lines = await parseStatementFile(file)
  if (!lines.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank statement contains no transactions')
  if (lines.some((line) => line.transactionDate < startDate || line.transactionDate > endDate)) throw new ApiError(httpStatus.BAD_REQUEST, 'Statement contains transaction dates outside the selected statement period')
  const openingBalanceMinor = moneyToMinorUnits(Number(input.openingBalance || 0), 'opening balance')
  const closingBalanceMinor = moneyToMinorUnits(Number(input.closingBalance || 0), 'closing balance')
  const statementNumber = String(input.statementNumber || '').trim() || await nextNumber(organizationId, 'bank-statement', 'STM', endDate, session)
  const rows = await FinanceBankStatement.create([{
    organizationId, bankAccountId: bank._id, statementNumber, startDate, endDate, openingBalanceMinor, closingBalanceMinor,
    currency: bank.currency, status: 'OPEN', sourceFileName: file.originalname, createdBy: actorObjectId(actor),
  }], session ? { session } : undefined)
  const statement = rows[0]
  await FinanceBankStatementLine.insertMany(lines.map((line, i) => ({ organizationId, statementId: statement._id, bankAccountId: bank._id, lineNumber: i + 1, ...line, status: 'UNMATCHED', matchedJournalLineIds: [], matchedAmountMinor: 0 })), { session })
  await audit(organizationId, actor, 'finance.bank_statement_imported', 'financeBankStatement', String(statement._id), 'Bank statement imported', { statementNumber, fileName: file.originalname, lineCount: lines.length }, session)
  return getBankStatement(organizationId, String(statement._id), session)
})
const listBankStatements = (organizationId: string, query: Record<string, unknown> = {}) => {
  const where: Record<string, any> = { organizationId }
  if (query.bankAccountId) where.bankAccountId = objectId(query.bankAccountId, 'bank account id')
  if (query.status) where.status = String(query.status).toUpperCase()
  return FinanceBankStatement.find(where).sort({ endDate: -1, createdAt: -1 }).populate('bankAccountId', 'name type glAccountId').lean()
}
const getBankStatement = async (organizationId: string, id: string, session?: ClientSession) => {
  const statementQuery = FinanceBankStatement.findOne({ _id: objectId(id, 'statement id'), organizationId }).populate('bankAccountId', 'name type glAccountId')
  const linesQuery = FinanceBankStatementLine.find({ statementId: objectId(id, 'statement id'), organizationId }).sort({ lineNumber: 1 })
  if (session) { statementQuery.session(session); linesQuery.session(session) }
  const [statement, lines] = await Promise.all([statementQuery.lean(), linesQuery.lean()])
  if (!statement) throw new ApiError(httpStatus.NOT_FOUND, 'Bank statement not found')
  const bank: any = statement.bankAccountId
  const ledgerClosingBalanceMinor = await glBalanceMinor(organizationId, bank?._id ? bank.glAccountId : (await bankAccount(organizationId, statement.bankAccountId, session, false)).glAccountId, statement.endDate)
  return { ...statement, lines, summary: { statementBalanceMinor: statement.closingBalanceMinor, ledgerBalanceMinor: ledgerClosingBalanceMinor, differenceMinor: statement.closingBalanceMinor - ledgerClosingBalanceMinor, unresolvedLines: lines.filter((line: any) => !['MATCHED', 'EXCLUDED', 'RECONCILED'].includes(line.status)).length } }
}
const matchStatementLine = async (organizationId: string, actor: AccountingActor, statementId: string, lineId: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const statement: any = await withSession(FinanceBankStatement.findOne({ _id: objectId(statementId, 'statement id'), organizationId, status: 'OPEN' }), session).lean()
  if (!statement) throw new ApiError(httpStatus.NOT_FOUND, 'Open bank statement not found')
  const line: any = await withSession(FinanceBankStatementLine.findOne({ _id: objectId(lineId, 'statement line id'), statementId: statement._id, organizationId }), session)
  if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'Bank statement line not found')
  const bank = await bankAccount(organizationId, statement.bankAccountId, session, false)
  const gl = await account(organizationId, bank.glAccountId, bank.type === 'CREDIT_CARD' ? ['LIABILITY'] : ['ASSET'], 'bank GL account', session)
  const ids = Array.isArray(input.journalLineIds) ? [...new Set(input.journalLineIds.map(String))] : []
  if (!ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Select at least one General Ledger line to match')
  const journalLines: any[] = await withSession(FinanceJournalLine.find({ _id: { $in: ids.map((id) => objectId(id, 'journal line id')) }, organizationId, accountId: gl._id, journalStatus: { $in: ['POSTED', 'REVERSED'] } }), session).lean()
  if (journalLines.length !== ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more selected ledger lines are invalid or belong to a different account/organization')
  const matchedAmountMinor = journalLines.reduce((sum, item) => sum + (gl.normalBalance === 'DEBIT' ? Number(item.debitMinor) - Number(item.creditMinor) : Number(item.creditMinor) - Number(item.debitMinor)), 0)
  line.matchedJournalLineIds = journalLines.map((item) => item._id); line.matchedAmountMinor = matchedAmountMinor
  line.status = matchedAmountMinor === line.amountMinor ? 'MATCHED' : 'PARTIAL'; line.exclusionReason = ''
  await line.save({ session })
  await audit(organizationId, actor, 'finance.bank_statement_line_matched', 'financeBankStatementLine', String(line._id), 'Bank statement line matched to General Ledger', { matchedAmountMinor, statementAmountMinor: line.amountMinor, status: line.status }, session)
  return line.toObject()
})
const excludeStatementLine = async (organizationId: string, actor: AccountingActor, statementId: string, lineId: string, reason: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const statement = await withSession(FinanceBankStatement.findOne({ _id: objectId(statementId, 'statement id'), organizationId, status: 'OPEN' }), session).lean()
  if (!statement) throw new ApiError(httpStatus.NOT_FOUND, 'Open bank statement not found')
  const line: any = await withSession(FinanceBankStatementLine.findOne({ _id: objectId(lineId, 'statement line id'), statementId: statement._id, organizationId }), session)
  if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'Bank statement line not found')
  line.status = 'EXCLUDED'; line.exclusionReason = reason; line.matchedJournalLineIds = []; line.matchedAmountMinor = 0; await line.save({ session })
  await audit(organizationId, actor, 'finance.bank_statement_line_excluded', 'financeBankStatementLine', String(line._id), reason, {}, session)
  return line.toObject()
})
const reconcileBankStatement = async (organizationId: string, actor: AccountingActor, statementId: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const statement: any = await withSession(FinanceBankStatement.findOne({ _id: objectId(statementId, 'statement id'), organizationId, status: 'OPEN' }), session)
  if (!statement) throw new ApiError(httpStatus.NOT_FOUND, 'Open bank statement not found')
  const unresolved = await withSession(FinanceBankStatementLine.countDocuments({ organizationId, statementId: statement._id, status: { $nin: ['MATCHED', 'EXCLUDED'] } }), session)
  if (unresolved > 0) throw new ApiError(httpStatus.CONFLICT, `${unresolved} statement line(s) are still unmatched or partial`)
  const bank = await bankAccount(organizationId, statement.bankAccountId, session, false)
  const ledgerClosingBalanceMinor = await glBalanceMinor(organizationId, bank.glAccountId, statement.endDate)
  const differenceMinor = Number(statement.closingBalanceMinor) - ledgerClosingBalanceMinor
  if (differenceMinor !== 0) throw new ApiError(httpStatus.CONFLICT, `Bank reconciliation difference must be zero before completion (difference minor units: ${differenceMinor})`, '', 'BANK_RECONCILIATION_NOT_BALANCED')
  const now = new Date(); statement.status = 'RECONCILED'; statement.reconciledAt = now; statement.reconciledBy = actorObjectId(actor); await statement.save({ session })
  await FinanceBankStatementLine.updateMany({ organizationId, statementId: statement._id, status: 'MATCHED' }, { $set: { status: 'RECONCILED' } }, { session })
  const rows = await FinanceReconciliation.create([{ organizationId, statementId: statement._id, bankAccountId: bank._id, statementClosingBalanceMinor: statement.closingBalanceMinor, ledgerClosingBalanceMinor, differenceMinor, reconciledAt: now, reconciledBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.bank_statement_reconciled', 'financeBankStatement', String(statement._id), 'Bank statement reconciled with zero difference', { ledgerClosingBalanceMinor, statementClosingBalanceMinor: statement.closingBalanceMinor }, session)
  return rows[0].toObject()
})
const ledgerCandidates = async (organizationId: string, statementId: string, query: Record<string, unknown> = {}) => {
  const statement: any = await FinanceBankStatement.findOne({ _id: objectId(statementId, 'statement id'), organizationId }).select('bankAccountId startDate endDate').lean()
  if (!statement) throw new ApiError(httpStatus.NOT_FOUND, 'Bank statement not found')
  const bank = await bankAccount(organizationId, statement.bankAccountId, undefined, false)
  const where: Record<string, any> = { organizationId, accountId: bank.glAccountId, journalStatus: { $in: ['POSTED', 'REVERSED'] } }
  const startDate = query.startDate || statement.startDate
  const endDate = query.endDate || statement.endDate
  where.postingDate = { $gte: dateValue(startDate, 'start date'), $lte: inclusiveEnd(endDate, 'end date') }
  return FinanceJournalLine.find(where).sort({ postingDate: -1, createdAt: -1 }).limit(500).lean()
}

export const FinanceOperationsService = {
  initializeOperations,
  receivables,
  listTaxCodes, createTaxCode, updateTaxCode,
  listBankAccounts, createBankAccount, updateBankAccount, transferBankFunds, listBankTransfers,
  createVendorBill, listVendorBills, getVendorBill, updateVendorBill, approveVendorBill, postVendorBill, payVendorBill, voidVendorBill, payables,
  createClientDeposit, listClientDeposits, applyClientDeposit, refundClientDeposit,
  createBankStatement, listBankStatements, getBankStatement, matchStatementLine, excludeStatementLine, reconcileBankStatement, ledgerCandidates,
  taxCode, taxMinor, bankAccount, ensureDefaultBankAccount,
}
