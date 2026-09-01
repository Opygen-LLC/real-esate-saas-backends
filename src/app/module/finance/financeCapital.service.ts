import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import type { AccountingActor, FinanceJournalLineInput } from './financeAccounting.interface'
import { FinanceAccount, FinanceAccountingSequence, FinanceJournalLine } from './financeAccounting.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccountingService } from './financeAccounting.service'
import { AccountingPostingService } from './accountingPosting.service'
import { FinanceBankAccount } from './financeOperations.model'
import { moneyToMinorUnits } from './finance.money'
import { FinanceDividend, FinanceEquityTransaction, FinanceLoan, FinanceShareholder, FinanceShareholderLoan } from './financeCapital.model'
import type { FinanceEquityTransactionType, FinanceLoanPaymentFrequency } from './financeCapital.interface'

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
const inclusiveEnd = (value: unknown) => {
  const raw = String(value || '').trim(); const date = dateValue(value, 'end date')
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date.setUTCHours(23, 59, 59, 999)
  return date
}
const moneyMinor = (value: unknown, label: string, allowZero = false) => {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`)
  return moneyToMinorUnits(amount, label)
}
const sharesValue = (value: unknown, label = 'shares', allowZero = true) => {
  const shares = Number(value || 0)
  if (!Number.isSafeInteger(shares) || shares < 0 || (!allowZero && shares === 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be ${allowZero ? 'a non-negative' : 'a positive'} whole number`)
  return shares
}
const rateBps = (value: unknown) => {
  const rate = Number(value || 0)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000) throw new ApiError(httpStatus.BAD_REQUEST, 'Interest rate must be between 0 and 1000 percent')
  return Math.round(rate * 100)
}
const withSession = <T>(query: T, session?: ClientSession): T => { if (session && typeof (query as any)?.session === 'function') (query as any).session(session); return query }
const audit = (organizationId: string, actor: AccountingActor, action: string, entityType: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) =>
  writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)
const nextNumber = async (organizationId: string, key: string, prefix: string, date: Date, session?: ClientSession) => {
  const year = date.getUTCFullYear()
  const row = await FinanceAccountingSequence.findOneAndUpdate({ organizationId, key: `${key}:${year}` }, { $inc: { value: 1 }, $setOnInsert: { organizationId, key: `${key}:${year}` } }, { upsert: true, new: true, session, setDefaultsOnInsert: true }).lean()
  if (!row) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to generate ${key} number`)
  return `${prefix}-${year}-${String(row.value).padStart(6, '0')}`
}
const settings = async (organizationId: string, session?: ClientSession) => {
  const row = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  if (!row) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before using capital accounting')
  return row
}
const accountById = async (organizationId: string, id: unknown, type: string | string[], label: string, session?: ClientSession) => {
  const types = Array.isArray(type) ? type : [type]
  const row = await withSession(FinanceAccount.findOne({ _id: objectId(id, label), organizationId, status: 'ACTIVE', type: { $in: types } }), session).lean()
  if (!row || !row.allowManualPosting) throw new ApiError(httpStatus.BAD_REQUEST, `${label} is invalid, inactive, non-posting, or belongs to another organization`)
  return row
}
const systemAccount = async (organizationId: string, key: string, types: string[], label: string, session?: ClientSession) => {
  const row = await withSession(FinanceAccount.findOne({ organizationId, systemKey: key, status: 'ACTIVE', type: { $in: types } }), session).lean()
  if (!row) throw new ApiError(httpStatus.CONFLICT, `${label} is not configured. Re-run Phase 5 accounting migration/initialization.`)
  return row
}
const bankAccount = async (organizationId: string, id: unknown, session?: ClientSession) => {
  const row: any = await withSession(FinanceBankAccount.findOne({ _id: objectId(id, 'bank account id'), organizationId, status: 'ACTIVE' }), session).lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Bank account not found')
  const gl = await accountById(organizationId, row.glAccountId, row.type === 'CREDIT_CARD' ? 'LIABILITY' : 'ASSET', 'bank GL account', session)
  return { ...row, gl }
}
const shareholder = async (organizationId: string, id: unknown, session?: ClientSession, active = true) => {
  const where: any = { _id: objectId(id, 'shareholder id'), organizationId }; if (active) where.status = 'ACTIVE'
  const row: any = await withSession(FinanceShareholder.findOne(where), session)
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Shareholder not found')
  return row
}
const post = (organizationId: string, actor: AccountingActor, input: Parameters<typeof AccountingPostingService.postAutomatedInSession>[2], session?: ClientSession) =>
  AccountingPostingService.postAutomatedInSession(organizationId, { ...actor, system: true }, input, session)

const recalculateOwnership = async (organizationId: string, session?: ClientSession) => {
  const rows: any[] = await withSession(FinanceShareholder.find({ organizationId }), session)
  const total = rows.reduce((sum, row) => sum + Number(row.sharesHeld || 0), 0)
  for (const row of rows) {
    row.ownershipPercentage = total > 0 ? Number(((Number(row.sharesHeld || 0) / total) * 100).toFixed(6)) : 0
    await row.save({ session })
  }
  return total
}

// Shareholder registry
const listShareholders = (organizationId: string) => FinanceShareholder.find({ organizationId }).sort({ status: 1, name: 1 }).lean()
const createShareholder = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const rows = await FinanceShareholder.create([{ organizationId, name: String(input.name).trim(), type: input.type, email: input.email || '', phone: input.phone || '', shareClass: input.shareClass || 'Ordinary', sharesHeld: sharesValue(input.sharesHeld), ownershipPercentage: 0, joinedAt: dateValue(input.joinedAt, 'joined date'), status: input.status || 'ACTIVE', notes: input.notes || '', createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await recalculateOwnership(organizationId, session)
  await audit(organizationId, actor, 'finance.shareholder_created', 'financeShareholder', String(rows[0]._id), 'Shareholder created', { name: rows[0].name, sharesHeld: rows[0].sharesHeld }, session)
  return withSession(FinanceShareholder.findById(rows[0]._id), session).lean()
})
const updateShareholder = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await shareholder(organizationId, id, session, false)
  if (input.sharesHeld !== undefined && Number(input.sharesHeld) !== Number(row.sharesHeld)) throw new ApiError(httpStatus.CONFLICT, 'Shares held must be changed through an equity transaction, not by editing the registry')
  for (const key of ['name','type','email','phone','shareClass','status','notes'] as const) if (input[key] !== undefined) row[key] = input[key]
  if (input.joinedAt !== undefined) row.joinedAt = dateValue(input.joinedAt, 'joined date')
  row.updatedBy = actorObjectId(actor); await row.save({ session }); await recalculateOwnership(organizationId, session)
  await audit(organizationId, actor, 'finance.shareholder_updated', 'financeShareholder', String(row._id), 'Shareholder updated', { status: row.status }, session)
  return row.toObject()
})

// Equity
const listEquityTransactions = (organizationId: string, query: Record<string, any> = {}) => {
  const where: any = { organizationId }; if (query.shareholderId) where.shareholderId = objectId(query.shareholderId, 'shareholder id'); if (query.type) where.type = query.type
  return FinanceEquityTransaction.find(where).sort({ transactionDate: -1, createdAt: -1 }).populate('shareholderId counterpartyShareholderId', 'name type shareClass sharesHeld ownershipPercentage').populate('bankAccountId', 'name type').lean()
}
const createEquityTransaction = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session); const type = String(input.type).toUpperCase() as FinanceEquityTransactionType; const transactionDate = dateValue(input.transactionDate, 'transaction date')
  if (['DIVIDEND_DECLARATION','DIVIDEND_PAYMENT'].includes(type)) throw new ApiError(httpStatus.BAD_REQUEST, 'Use the dividend workflow for dividend transactions')
  const holder: any = input.shareholderId ? await shareholder(organizationId, input.shareholderId, session) : null
  const counterparty: any = input.counterpartyShareholderId ? await shareholder(organizationId, input.counterpartyShareholderId, session) : null
  const shares = sharesValue(input.shares, 'shares', type === 'SHARE_TRANSFER' ? false : true)
  const amountMinor = type === 'SHARE_TRANSFER' ? 0 : moneyMinor(input.amount, 'amount')
  const hasShareCapitalSplit = input.shareCapitalAmount !== undefined && input.shareCapitalAmount !== null && input.shareCapitalAmount !== ''
  const hasApicSplit = input.additionalPaidInCapitalAmount !== undefined && input.additionalPaidInCapitalAmount !== null && input.additionalPaidInCapitalAmount !== ''
  let shareCapitalMinor = hasShareCapitalSplit ? moneyMinor(input.shareCapitalAmount, 'share capital amount', true) : (hasApicSplit ? Math.max(0, amountMinor - moneyMinor(input.additionalPaidInCapitalAmount, 'additional paid-in capital amount', true)) : amountMinor)
  let additionalPaidInCapitalMinor = hasApicSplit ? moneyMinor(input.additionalPaidInCapitalAmount, 'additional paid-in capital amount', true) : Math.max(0, amountMinor - shareCapitalMinor)
  if (['OWNER_DRAW','SHARE_BUYBACK','CAPITAL_RETURN'].includes(type)) { shareCapitalMinor = 0; additionalPaidInCapitalMinor = 0 }
  if (['CAPITAL_CONTRIBUTION','SHARE_ISSUE'].includes(type) && shareCapitalMinor + additionalPaidInCapitalMinor !== amountMinor) throw new ApiError(httpStatus.BAD_REQUEST, 'Share capital plus additional paid-in capital must equal the transaction amount')
  if (['CAPITAL_CONTRIBUTION','SHARE_ISSUE','SHARE_BUYBACK','CAPITAL_RETURN','OWNER_DRAW'].includes(type) && !holder) throw new ApiError(httpStatus.BAD_REQUEST, 'Shareholder is required')
  if (type === 'SHARE_ISSUE' && shares <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Share issue requires a positive number of shares')
  if (type === 'SHARE_TRANSFER') {
    if (!holder || !counterparty || String(holder._id) === String(counterparty._id)) throw new ApiError(httpStatus.BAD_REQUEST, 'Share transfer requires different source and destination shareholders')
    if (String(holder.shareClass).trim().toLowerCase() !== String(counterparty.shareClass).trim().toLowerCase()) throw new ApiError(httpStatus.CONFLICT, 'Share transfers must stay within the same share class')
    if (Number(holder.sharesHeld) < shares) throw new ApiError(httpStatus.CONFLICT, 'Source shareholder does not hold enough shares')
  }
  if (['SHARE_BUYBACK','CAPITAL_RETURN'].includes(type) && shares > Number(holder?.sharesHeld || 0)) throw new ApiError(httpStatus.CONFLICT, 'Shareholder does not hold enough shares')
  const number = await nextNumber(organizationId, 'equity', 'EQT', transactionDate, session)
  const created = await FinanceEquityTransaction.create([{ organizationId, transactionNumber: number, type, shareholderId: holder?._id || null, counterpartyShareholderId: counterparty?._id || null, shares, amountMinor, shareCapitalMinor, additionalPaidInCapitalMinor, currency: s.baseCurrency, transactionDate, bankAccountId: input.bankAccountId || null, reference: input.reference || '', notes: input.notes || '', journalEntryId: null, createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  const row: any = created[0]
  let journal: any = null
  if (type === 'SHARE_TRANSFER') {
    holder.sharesHeld -= shares; counterparty.sharesHeld += shares; await holder.save({ session }); await counterparty.save({ session })
  } else {
    const bank = await bankAccount(organizationId, input.bankAccountId, session)
    const shareCapital = await systemAccount(organizationId, 'SHARE_CAPITAL', ['EQUITY'], 'Share Capital account', session)
    const apic = await systemAccount(organizationId, 'ADDITIONAL_PAID_IN_CAPITAL', ['EQUITY'], 'Additional Paid-in Capital account', session)
    const retained = await systemAccount(organizationId, 'RETAINED_EARNINGS', ['EQUITY'], 'Retained Earnings account', session)
    const lines: FinanceJournalLineInput[] = []
    if (['CAPITAL_CONTRIBUTION','SHARE_ISSUE'].includes(type)) {
      lines.push({ accountId: String(bank.gl._id), debitMinor: amountMinor, description: `${type} cash received`, shareholderId: String(holder._id) })
      if (shareCapitalMinor) lines.push({ accountId: String(shareCapital._id), creditMinor: shareCapitalMinor, description: 'Share capital', shareholderId: String(holder._id) })
      if (additionalPaidInCapitalMinor) lines.push({ accountId: String(apic._id), creditMinor: additionalPaidInCapitalMinor, description: 'Additional paid-in capital', shareholderId: String(holder._id) })
    } else if (type === 'OWNER_DRAW') {
      lines.push({ accountId: String(retained._id), debitMinor: amountMinor, description: 'Owner draw', shareholderId: String(holder._id) }, { accountId: String(bank.gl._id), creditMinor: amountMinor, description: 'Owner draw paid', shareholderId: String(holder._id) })
    } else {
      lines.push({ accountId: String(shareCapital._id), debitMinor: amountMinor, description: type === 'SHARE_BUYBACK' ? 'Share buyback' : 'Capital return', shareholderId: String(holder._id) }, { accountId: String(bank.gl._id), creditMinor: amountMinor, description: `${type} paid`, shareholderId: String(holder._id) })
    }
    journal = await post(organizationId, actor, { sourceType: `EQUITY_${type}`, sourceId: String(row._id), postingDate: transactionDate, entryDate: transactionDate, description: `${type.replace(/_/g, ' ')} - ${holder.name}`, reference: input.reference || number, currency: s.baseCurrency, lines }, session)
    row.bankAccountId = bank._id; row.journalEntryId = journal._id; await row.save({ session })
    if (type === 'SHARE_ISSUE') holder.sharesHeld += shares
    if (['SHARE_BUYBACK','CAPITAL_RETURN'].includes(type) && shares) holder.sharesHeld -= shares
    await holder.save({ session })
  }
  await recalculateOwnership(organizationId, session)
  await audit(organizationId, actor, 'finance.equity_transaction_posted', 'financeEquityTransaction', String(row._id), 'Equity transaction recorded', { type, transactionNumber: number, amountMinor, shares, journalEntryId: journal?._id ? String(journal._id) : null }, session)
  return row.toObject()
})

// Shareholder loans
const listShareholderLoans = (organizationId: string) => FinanceShareholderLoan.find({ organizationId }).sort({ startDate: -1 }).populate('shareholderId', 'name sharesHeld ownershipPercentage').populate('bankAccountId', 'name type').populate('liabilityAccountId interestExpenseAccountId', 'code name type').lean()
const createShareholderLoan = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session); const holder: any = await shareholder(organizationId, input.shareholderId, session); const bank = await bankAccount(organizationId, input.bankAccountId, session)
  const liability = input.liabilityAccountId ? await accountById(organizationId, input.liabilityAccountId, 'LIABILITY', 'shareholder loan liability account', session) : await systemAccount(organizationId, 'SHAREHOLDER_LOAN_PAYABLE', ['LIABILITY'], 'Shareholder Loan Payable account', session)
  const interest = input.interestExpenseAccountId ? await accountById(organizationId, input.interestExpenseAccountId, 'EXPENSE', 'interest expense account', session) : await systemAccount(organizationId, 'INTEREST_EXPENSE', ['EXPENSE'], 'Interest Expense account', session)
  const principalMinor = moneyMinor(input.principal, 'principal'); const startDate = dateValue(input.startDate, 'start date'); const number = await nextNumber(organizationId, 'shareholder-loan', 'SHL', startDate, session); const _id = new mongoose.Types.ObjectId()
  const journal: any = await post(organizationId, actor, { sourceType: 'SHAREHOLDER_LOAN_RECEIPT', sourceId: String(_id), postingDate: startDate, entryDate: startDate, description: `Shareholder loan from ${holder.name}`, reference: input.reference || number, currency: s.baseCurrency, lines: [{ accountId: String(bank.gl._id), debitMinor: principalMinor, description: 'Loan proceeds received', shareholderId: String(holder._id) }, { accountId: String(liability._id), creditMinor: principalMinor, description: 'Shareholder loan payable', shareholderId: String(holder._id) }] }, session)
  const rows = await FinanceShareholderLoan.create([{ _id, organizationId, loanNumber: number, shareholderId: holder._id, principalMinor, outstandingPrincipalMinor: principalMinor, interestRateBasisPoints: rateBps(input.interestRatePercent), startDate, maturityDate: input.maturityDate ? dateValue(input.maturityDate, 'maturity date') : null, paymentFrequency: (input.paymentFrequency || 'MONTHLY') as FinanceLoanPaymentFrequency, currency: s.baseCurrency, bankAccountId: bank._id, liabilityAccountId: liability._id, interestExpenseAccountId: interest._id, receiptJournalId: journal._id, payments: [], status: 'ACTIVE', reference: input.reference || '', notes: input.notes || '', createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.shareholder_loan_received', 'financeShareholderLoan', String(rows[0]._id), 'Shareholder loan received', { loanNumber: number, principalMinor, shareholderId: String(holder._id), journalEntryId: String(journal._id) }, session)
  return rows[0].toObject()
})
const payShareholderLoan = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceShareholderLoan.findOne({ _id: objectId(id, 'shareholder loan id'), organizationId, status: 'ACTIVE' }), session); if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Active shareholder loan not found')
  const principalMinor = moneyMinor(input.principal || 0, 'principal', true), interestMinor = moneyMinor(input.interest || 0, 'interest', true); if (principalMinor + interestMinor <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment must include principal or interest'); if (principalMinor > row.outstandingPrincipalMinor) throw new ApiError(httpStatus.CONFLICT, 'Principal payment exceeds outstanding principal')
  const bank = await bankAccount(organizationId, input.bankAccountId || row.bankAccountId, session); const paymentId = new mongoose.Types.ObjectId(); const paidAt = input.paidAt ? dateValue(input.paidAt, 'payment date') : new Date()
  const lines: FinanceJournalLineInput[] = []; if (principalMinor) lines.push({ accountId: String(row.liabilityAccountId), debitMinor: principalMinor, description: 'Shareholder loan principal repayment', shareholderId: String(row.shareholderId) }); if (interestMinor) lines.push({ accountId: String(row.interestExpenseAccountId), debitMinor: interestMinor, description: 'Shareholder loan interest', shareholderId: String(row.shareholderId) }); lines.push({ accountId: String(bank.gl._id), creditMinor: principalMinor + interestMinor, description: 'Shareholder loan payment', shareholderId: String(row.shareholderId) })
  const journal: any = await post(organizationId, actor, { sourceType: 'SHAREHOLDER_LOAN_PAYMENT', sourceId: String(paymentId), postingDate: paidAt, entryDate: paidAt, description: `Payment for ${row.loanNumber}`, reference: input.reference || row.loanNumber, lines }, session)
  row.payments.push({ _id: paymentId, paidAt, principalMinor, interestMinor, bankAccountId: bank._id, reference: input.reference || '', journalEntryId: journal._id, recordedBy: actorObjectId(actor) }); row.outstandingPrincipalMinor -= principalMinor; if (row.outstandingPrincipalMinor === 0) row.status = 'PAID'; row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.shareholder_loan_payment_posted', 'financeShareholderLoan', String(row._id), 'Shareholder loan payment posted', { principalMinor, interestMinor, journalEntryId: String(journal._id) }, session); return row.toObject()
})

// Dividends
const listDividends = (organizationId: string) => FinanceDividend.find({ organizationId }).sort({ declarationDate: -1 }).populate('shareholderId', 'name sharesHeld ownershipPercentage').populate('retainedEarningsAccountId dividendPayableAccountId', 'code name type').lean()
const createDividend = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session); if (input.shareholderId) await shareholder(organizationId, input.shareholderId, session)
  const retained = await systemAccount(organizationId, 'RETAINED_EARNINGS', ['EQUITY'], 'Retained Earnings account', session); const payable = await systemAccount(organizationId, 'DIVIDEND_PAYABLE', ['LIABILITY'], 'Dividend Payable account', session); const declarationDate = dateValue(input.declarationDate, 'declaration date'); const number = await nextNumber(organizationId, 'dividend', 'DIV', declarationDate, session)
  const rows = await FinanceDividend.create([{ organizationId, dividendNumber: number, shareholderId: input.shareholderId || null, description: String(input.description).trim(), amountMinor: moneyMinor(input.amount, 'dividend amount'), paidMinor: 0, currency: s.baseCurrency, declarationDate, paymentDueDate: input.paymentDueDate ? dateValue(input.paymentDueDate, 'payment due date') : null, status: 'DRAFT', retainedEarningsAccountId: retained._id, dividendPayableAccountId: payable._id, declarationJournalId: null, payments: [], notes: input.notes || '', createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.dividend_created', 'financeDividend', String(rows[0]._id), 'Dividend draft created', { dividendNumber: number, amountMinor: rows[0].amountMinor }, session); return rows[0].toObject()
})
const approveDividend = async (organizationId: string, actor: AccountingActor, id: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceDividend.findOne({ _id: objectId(id, 'dividend id'), organizationId, status: 'DRAFT' }), session); if (!row) throw new ApiError(httpStatus.CONFLICT, 'Only draft dividends can be approved')
  row.status = 'APPROVED'; row.approvedAt = new Date(); row.approvedBy = actorObjectId(actor); row.updatedBy = actorObjectId(actor); await row.save({ session }); await audit(organizationId, actor, 'finance.dividend_approved', 'financeDividend', String(row._id), 'Dividend approved', { amountMinor: row.amountMinor }, session); return row.toObject()
})
const declareDividend = async (organizationId: string, actor: AccountingActor, id: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceDividend.findOne({ _id: objectId(id, 'dividend id'), organizationId, status: 'APPROVED' }), session); if (!row) throw new ApiError(httpStatus.CONFLICT, 'Only approved dividends can be declared')
  const shareholderId = row.shareholderId ? String(row.shareholderId) : null
  const journal: any = await post(organizationId, actor, { sourceType: 'DIVIDEND_DECLARATION', sourceId: String(row._id), postingDate: row.declarationDate, entryDate: row.declarationDate, description: row.description, reference: row.dividendNumber, lines: [{ accountId: String(row.retainedEarningsAccountId), debitMinor: row.amountMinor, description: 'Dividend declared', shareholderId }, { accountId: String(row.dividendPayableAccountId), creditMinor: row.amountMinor, description: 'Dividend payable', shareholderId }] }, session)
  row.status = 'DECLARED'; row.declarationJournalId = journal._id; row.declaredAt = new Date(); row.declaredBy = actorObjectId(actor); row.updatedBy = actorObjectId(actor); await row.save({ session })
  const eqNo = await nextNumber(organizationId, 'equity', 'EQT', row.declarationDate, session); await FinanceEquityTransaction.create([{ organizationId, transactionNumber: eqNo, type: 'DIVIDEND_DECLARATION', shareholderId: row.shareholderId || null, shares: 0, amountMinor: row.amountMinor, shareCapitalMinor: 0, additionalPaidInCapitalMinor: 0, currency: row.currency, transactionDate: row.declarationDate, reference: row.dividendNumber, journalEntryId: journal._id, sourceDocumentId: row._id, createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.dividend_declared', 'financeDividend', String(row._id), 'Dividend declared and posted', { journalEntryId: String(journal._id) }, session); return row.toObject()
})
const payDividend = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceDividend.findOne({ _id: objectId(id, 'dividend id'), organizationId, status: 'DECLARED' }), session); if (!row) throw new ApiError(httpStatus.CONFLICT, 'Only declared dividends can be paid')
  const remaining = row.amountMinor - row.paidMinor; const amountMinor = moneyMinor(input.amount ?? remaining / 100, 'dividend payment'); if (amountMinor > remaining) throw new ApiError(httpStatus.CONFLICT, 'Dividend payment exceeds the remaining declared amount')
  const bank = await bankAccount(organizationId, input.bankAccountId, session); const paymentId = new mongoose.Types.ObjectId(); const paidAt = input.paidAt ? dateValue(input.paidAt, 'payment date') : new Date(); const shareholderId = row.shareholderId ? String(row.shareholderId) : null
  const journal: any = await post(organizationId, actor, { sourceType: 'DIVIDEND_PAYMENT', sourceId: String(paymentId), postingDate: paidAt, entryDate: paidAt, description: `Dividend payment ${row.dividendNumber}`, reference: input.reference || row.dividendNumber, lines: [{ accountId: String(row.dividendPayableAccountId), debitMinor: amountMinor, description: 'Dividend payable cleared', shareholderId }, { accountId: String(bank.gl._id), creditMinor: amountMinor, description: 'Dividend cash payment', shareholderId }] }, session)
  row.payments.push({ _id: paymentId, paidAt, amountMinor, bankAccountId: bank._id, reference: input.reference || '', journalEntryId: journal._id, recordedBy: actorObjectId(actor) }); row.paidMinor += amountMinor; if (row.paidMinor === row.amountMinor) row.status = 'PAID'; row.updatedBy = actorObjectId(actor); await row.save({ session })
  const eqNo = await nextNumber(organizationId, 'equity', 'EQT', paidAt, session); await FinanceEquityTransaction.create([{ organizationId, transactionNumber: eqNo, type: 'DIVIDEND_PAYMENT', shareholderId: row.shareholderId || null, shares: 0, amountMinor, shareCapitalMinor: 0, additionalPaidInCapitalMinor: 0, currency: row.currency, transactionDate: paidAt, bankAccountId: bank._id, reference: input.reference || row.dividendNumber, journalEntryId: journal._id, sourceDocumentId: row._id, createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.dividend_payment_posted', 'financeDividend', String(row._id), 'Dividend payment posted', { amountMinor, journalEntryId: String(journal._id), status: row.status }, session); return row.toObject()
})

// Company loans
const listLoans = (organizationId: string) => FinanceLoan.find({ organizationId }).sort({ startDate: -1 }).populate('bankAccountId', 'name type').populate('liabilityAccountId interestExpenseAccountId', 'code name type').lean()
const createLoan = async (organizationId: string, actor: AccountingActor, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const s = await settings(organizationId, session); const bank = await bankAccount(organizationId, input.bankAccountId, session); const liability = input.liabilityAccountId ? await accountById(organizationId, input.liabilityAccountId, 'LIABILITY', 'loan liability account', session) : await systemAccount(organizationId, 'LOANS_PAYABLE', ['LIABILITY'], 'Loans Payable account', session); const interest = input.interestExpenseAccountId ? await accountById(organizationId, input.interestExpenseAccountId, 'EXPENSE', 'interest expense account', session) : await systemAccount(organizationId, 'INTEREST_EXPENSE', ['EXPENSE'], 'Interest Expense account', session)
  const principalMinor = moneyMinor(input.principal, 'principal'); const startDate = dateValue(input.startDate, 'start date'); const number = await nextNumber(organizationId, 'company-loan', 'LOAN', startDate, session); const _id = new mongoose.Types.ObjectId()
  const journal: any = await post(organizationId, actor, { sourceType: 'COMPANY_LOAN_RECEIPT', sourceId: String(_id), postingDate: startDate, entryDate: startDate, description: `Loan proceeds from ${String(input.lender).trim()}`, reference: input.reference || number, currency: s.baseCurrency, lines: [{ accountId: String(bank.gl._id), debitMinor: principalMinor, description: 'Loan proceeds received' }, { accountId: String(liability._id), creditMinor: principalMinor, description: 'Loan payable' }] }, session)
  const rows = await FinanceLoan.create([{ _id, organizationId, loanNumber: number, lender: String(input.lender).trim(), principalMinor, outstandingPrincipalMinor: principalMinor, interestRateBasisPoints: rateBps(input.interestRatePercent), startDate, maturityDate: input.maturityDate ? dateValue(input.maturityDate, 'maturity date') : null, paymentFrequency: (input.paymentFrequency || 'MONTHLY') as FinanceLoanPaymentFrequency, currency: s.baseCurrency, bankAccountId: bank._id, liabilityAccountId: liability._id, interestExpenseAccountId: interest._id, receiptJournalId: journal._id, payments: [], status: 'ACTIVE', reference: input.reference || '', notes: input.notes || '', createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  await audit(organizationId, actor, 'finance.company_loan_received', 'financeLoan', String(rows[0]._id), 'Company loan received', { loanNumber: number, principalMinor, journalEntryId: String(journal._id) }, session); return rows[0].toObject()
})
const payLoan = async (organizationId: string, actor: AccountingActor, id: string, input: Record<string, any>) => FinanceAccountingService.accountingTransaction(async (session) => {
  const row: any = await withSession(FinanceLoan.findOne({ _id: objectId(id, 'loan id'), organizationId, status: 'ACTIVE' }), session); if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Active company loan not found')
  const principalMinor = moneyMinor(input.principal || 0, 'principal', true), interestMinor = moneyMinor(input.interest || 0, 'interest', true), feesMinor = moneyMinor(input.fees || 0, 'fees', true); if (principalMinor + interestMinor + feesMinor <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment must include principal, interest, or fees'); if (principalMinor > row.outstandingPrincipalMinor) throw new ApiError(httpStatus.CONFLICT, 'Principal payment exceeds outstanding principal')
  const bank = await bankAccount(organizationId, input.bankAccountId || row.bankAccountId, session); const paymentId = new mongoose.Types.ObjectId(); const paidAt = input.paidAt ? dateValue(input.paidAt, 'payment date') : new Date(); const lines: FinanceJournalLineInput[] = []
  if (principalMinor) lines.push({ accountId: String(row.liabilityAccountId), debitMinor: principalMinor, description: 'Loan principal repayment' }); if (interestMinor + feesMinor) lines.push({ accountId: String(row.interestExpenseAccountId), debitMinor: interestMinor + feesMinor, description: feesMinor ? 'Loan interest and fees' : 'Loan interest' }); lines.push({ accountId: String(bank.gl._id), creditMinor: principalMinor + interestMinor + feesMinor, description: 'Company loan payment' })
  const journal: any = await post(organizationId, actor, { sourceType: 'COMPANY_LOAN_PAYMENT', sourceId: String(paymentId), postingDate: paidAt, entryDate: paidAt, description: `Payment for ${row.loanNumber}`, reference: input.reference || row.loanNumber, lines }, session)
  row.payments.push({ _id: paymentId, paidAt, principalMinor, interestMinor, feesMinor, bankAccountId: bank._id, reference: input.reference || '', journalEntryId: journal._id, recordedBy: actorObjectId(actor) }); row.outstandingPrincipalMinor -= principalMinor; if (row.outstandingPrincipalMinor === 0) row.status = 'PAID'; row.updatedBy = actorObjectId(actor); await row.save({ session })
  await audit(organizationId, actor, 'finance.company_loan_payment_posted', 'financeLoan', String(row._id), 'Company loan payment posted', { principalMinor, interestMinor, feesMinor, journalEntryId: String(journal._id) }, session); return row.toObject()
})

// Retained earnings bridge report (before formal year-end close in Phase 7)
const retainedEarnings = async (organizationId: string, query: Record<string, any> = {}) => {
  const now = new Date(); const start = query.startDate ? dateValue(query.startDate, 'start date') : new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); const end = query.endDate ? inclusiveEnd(query.endDate) : now; if (start > end) throw new ApiError(httpStatus.BAD_REQUEST, 'startDate must be before endDate')
  const retained = await systemAccount(organizationId, 'RETAINED_EARNINGS', ['EQUITY'], 'Retained Earnings account')
  const revenueAccounts = await FinanceAccount.find({ organizationId, type: 'REVENUE' }).select('_id').lean(); const expenseAccounts = await FinanceAccount.find({ organizationId, type: 'EXPENSE' }).select('_id').lean()
  const sumLines = async (where: Record<string, any>) => { const rows: any[] = await FinanceJournalLine.find({ organizationId, journalStatus: 'POSTED', ...where }).select('debitMinor creditMinor sourceType').lean(); return rows }
  const openingRows = await sumLines({ accountId: retained._id, postingDate: { $lt: start } }); const openingMinor = openingRows.reduce((s, l) => s + Number(l.creditMinor || 0) - Number(l.debitMinor || 0), 0)
  const periodRange = { $gte: start, $lte: end }; const revenueRows = await sumLines({ accountId: { $in: revenueAccounts.map((a: any) => a._id) }, postingDate: periodRange }); const expenseRows = await sumLines({ accountId: { $in: expenseAccounts.map((a: any) => a._id) }, postingDate: periodRange })
  const revenueMinor = revenueRows.reduce((s, l) => s + Number(l.creditMinor || 0) - Number(l.debitMinor || 0), 0); const expenseMinor = expenseRows.reduce((s, l) => s + Number(l.debitMinor || 0) - Number(l.creditMinor || 0), 0); const netIncomeMinor = revenueMinor - expenseMinor
  const retainedPeriodRows = await sumLines({ accountId: retained._id, postingDate: periodRange }); const dividendsMinor = retainedPeriodRows.filter((l) => l.sourceType === 'DIVIDEND_DECLARATION').reduce((s, l) => s + Number(l.debitMinor || 0) - Number(l.creditMinor || 0), 0); const adjustmentsMinor = retainedPeriodRows.filter((l) => l.sourceType !== 'DIVIDEND_DECLARATION').reduce((s, l) => s + Number(l.creditMinor || 0) - Number(l.debitMinor || 0), 0)
  return { startDate: start, endDate: end, openingRetainedEarningsMinor: openingMinor, revenueMinor, expenseMinor, netIncomeMinor, dividendsMinor, adjustmentsMinor, closingRetainedEarningsMinor: openingMinor + netIncomeMinor - dividendsMinor + adjustmentsMinor, retainedEarningsAccount: { _id: retained._id, code: retained.code, name: retained.name } }
}

const initializeCapital = async (organizationId: string, actor: AccountingActor) => FinanceAccountingService.accountingTransaction(async (session) => {
  await settings(organizationId, session)
  const accountingSettings = await settings(organizationId, session)
  for (const definition of [
    { code: '2510', name: 'Shareholder Loans Payable', type: 'LIABILITY', parent: '2000', systemKey: 'SHAREHOLDER_LOAN_PAYABLE' },
    { code: '2520', name: 'Dividends Payable', type: 'LIABILITY', parent: '2000', systemKey: 'DIVIDEND_PAYABLE' },
    { code: '5810', name: 'Interest Expense', type: 'EXPENSE', parent: '5000', systemKey: 'INTEREST_EXPENSE' },
  ] as const) {
    const existing = await withSession(FinanceAccount.findOne({ organizationId, systemKey: definition.systemKey }), session).lean()
    if (existing) continue
    const parent = await withSession(FinanceAccount.findOne({ organizationId, code: definition.parent }), session).lean()
    if (!parent) throw new ApiError(httpStatus.CONFLICT, `Missing parent account ${definition.parent}`)
    let code = definition.code
    for (let offset = 0; offset < 90; offset += 1) {
      const candidate = String(Number(definition.code) + offset).padStart(definition.code.length, '0')
      const occupied = await withSession(FinanceAccount.exists({ organizationId, code: candidate }), session)
      if (!occupied) { code = candidate; break }
      if (offset === 89) throw new ApiError(httpStatus.CONFLICT, `No available account code near ${definition.code} for ${definition.name}`)
    }
    await FinanceAccount.create([{ organizationId, code, name: definition.name, type: definition.type, parentAccountId: parent._id, normalBalance: definition.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT', currency: accountingSettings.baseCurrency, systemKey: definition.systemKey, isSystem: true, allowManualPosting: true, status: 'ACTIVE', createdBy: actorObjectId(actor) }], session ? { session } : undefined)
  }
  await audit(organizationId, actor, 'finance.capital_accounting_initialized', 'financeCapital', organizationId, 'Phase 5 capital accounting initialized', {}, session)
  return { initialized: true }
})

export const FinanceCapitalService = {
  initializeCapital,
  listShareholders, createShareholder, updateShareholder,
  listEquityTransactions, createEquityTransaction,
  listShareholderLoans, createShareholderLoan, payShareholderLoan,
  listDividends, createDividend, approveDividend, declareDividend, payDividend,
  listLoans, createLoan, payLoan,
  retainedEarnings,
}
