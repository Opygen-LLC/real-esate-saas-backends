import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import type { AccountingActor, FinanceJournalLineInput } from './financeAccounting.interface'
import { FinanceAccount, FinanceJournalEntry } from './financeAccounting.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccountingService } from './financeAccounting.service'
import { AccountingPostingService } from './accountingPosting.service'
import { FinanceCategoryMappingService } from './financeCategoryMapping.service'
import { moneyToMinorUnits } from './finance.money'
import { FinanceBankAccount, FinanceTaxCode } from './financeOperations.model'

const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}

const id = (value: unknown) => value ? String((value as any)?._id || value) : null
const propertyDimension = (value: unknown) => id(value)

const minor = (amount: unknown, field = 'amount') => {
  const value = Number(amount || 0)
  if (!Number.isFinite(value) || value < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${field} must be a non-negative amount`)
  return moneyToMinorUnits(value, field)
}

const getSettings = async (organizationId: string, session?: ClientSession) => {
  const settings = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
  if (!settings) throw new ApiError(httpStatus.CONFLICT, 'Initialize accounting before automatic GL posting')
  return settings
}

const accountFromRef = async (organizationId: string, accountRef: unknown, expectedType: string, label: string, session?: ClientSession) => {
  if (!accountRef || !mongoose.isValidObjectId(String(accountRef))) throw new ApiError(httpStatus.CONFLICT, `${label} is not configured in accounting settings`)
  const account = await withSession(FinanceAccount.findOne({ _id: accountRef, organizationId, status: 'ACTIVE', type: expectedType }), session).lean()
  if (!account) throw new ApiError(httpStatus.CONFLICT, `${label} is inactive, invalid, or belongs to another organization`)
  return account
}


const bankGlAccount = async (organizationId: string, bankAccountId: unknown, fallbackAccountRef: unknown, session?: ClientSession) => {
  if (!bankAccountId) return accountFromRef(organizationId, fallbackAccountRef, 'ASSET', 'Default bank account', session)
  if (!mongoose.isValidObjectId(String(bankAccountId))) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid finance bank account')
  const bank = await withSession(FinanceBankAccount.findOne({ _id: bankAccountId, organizationId, status: 'ACTIVE' }), session).lean()
  if (!bank) throw new ApiError(httpStatus.BAD_REQUEST, 'Finance bank account is inactive or belongs to another organization')
  const gl = await withSession(FinanceAccount.findOne({ _id: bank.glAccountId, organizationId, status: 'ACTIVE' }), session).lean()
  if (!gl || !['ASSET', 'LIABILITY'].includes(gl.type)) throw new ApiError(httpStatus.CONFLICT, 'Finance bank account is not linked to a valid active cash/bank General Ledger account')
  return gl
}

const isAutomaticPostingReady = async (organizationId: string, session?: ClientSession) => {
  // Once an organization has an ACTIVE ledger, keep that ledger synchronized
  // even during a subscription downgrade. Advanced-accounting UI/API writes are
  // still entitlement-gated, but legacy/basic Finance is allowed to continue and
  // must not create an accounting gap that only becomes visible after re-upgrade.
  const initialized = await withSession(FinanceAccount.exists({ organizationId, systemKey: 'ASSETS_ROOT', status: 'ACTIVE' }), session)
  if (!initialized) return false
  const settings = await withSession(FinanceAccountingSettings.findOne({ organizationId }).select('activationStatus'), session).lean()
  return Boolean(settings && String(settings.activationStatus || 'ACTIVE') === 'ACTIVE')
}

const postAutomaticJournal = async (
  organizationId: string,
  actor: AccountingActor,
  input: { sourceType: string; sourceId: string; postingDate: Date; entryDate?: Date; description: string; reference?: string; lines: FinanceJournalLineInput[]; idempotencyKey?: string; currency?: string },
  session?: ClientSession,
) => AccountingPostingService.postAutomatedInSession(organizationId, { ...actor, system: true }, {
  sourceType: input.sourceType,
  sourceId: input.sourceId,
  idempotencyKey: input.idempotencyKey || `${input.sourceType.toUpperCase()}:${input.sourceId}`,
  entryDate: input.entryDate || input.postingDate,
  postingDate: input.postingDate,
  description: input.description,
  reference: input.reference,
  currency: input.currency,
  lines: input.lines,
}, session)

const reverseLinkedJournal = async (organizationId: string, actor: AccountingActor, journalId: unknown, reason: string, reversalDate: Date, session?: ClientSession) => {
  if (!journalId) return null
  const query = FinanceJournalEntry.findOne({ _id: journalId, organizationId })
  if (session) query.session(session)
  const journal: any = await query.lean()
  if (!journal) throw new ApiError(httpStatus.CONFLICT, 'Linked accounting journal no longer exists')
  if (journal.status === 'REVERSED') return { original: journal, reversal: null }
  if (journal.status !== 'POSTED') throw new ApiError(httpStatus.CONFLICT, 'Linked accounting journal is not posted')
  return FinanceAccountingService.reverseJournalInternal(organizationId, actor, String(journal._id), { reason, reversalDate }, session)
}

const postManualTransaction = async (organizationId: string, actor: AccountingActor, transaction: any, version: number, session?: ClientSession) => {
  if (transaction.status !== 'paid' || Number(transaction.amount || 0) <= 0) return null
  const settings = await getSettings(organizationId, session)
  const bank = await bankGlAccount(organizationId, transaction.bankAccountId, settings.defaultAccounts?.bank, session)
  const categoryAccount = await FinanceCategoryMappingService.resolveAccount(organizationId, actor, transaction.type, transaction.category, session)
  const amountMinor = minor(transaction.amount)
  const dimensions = { propertyId: propertyDimension(transaction.propertyId), vendorId: id(transaction.vendorId) }
  const lines: FinanceJournalLineInput[] = transaction.type === 'income'
    ? [
      { accountId: String(bank._id), debitMinor: amountMinor, description: transaction.description, ...dimensions },
      { accountId: String(categoryAccount._id), creditMinor: amountMinor, description: transaction.description, ...dimensions },
    ]
    : [
      { accountId: String(categoryAccount._id), debitMinor: amountMinor, description: transaction.description, ...dimensions },
      { accountId: String(bank._id), creditMinor: amountMinor, description: transaction.description, ...dimensions },
    ]
  return postAutomaticJournal(organizationId, actor, {
    sourceType: 'MANUAL_TRANSACTION', sourceId: `${transaction._id}:v${version}`, currency: transaction.currency || 'BDT', postingDate: new Date(transaction.transactionDate), description: `Manual ${transaction.type}: ${transaction.description}`, reference: transaction.reference || '', lines,
  }, session)
}

const postInvoiceRevenue = async (organizationId: string, actor: AccountingActor, invoice: any, version: number, session?: ClientSession) => {
  if (Number(invoice.total || 0) <= 0 || invoice.status === 'draft' || invoice.status === 'cancelled') return null
  const settings = await getSettings(organizationId, session)
  const ar = await accountFromRef(organizationId, settings.defaultAccounts?.accountsReceivable, 'ASSET', 'Accounts Receivable account', session)
  const revenue = await accountFromRef(organizationId, settings.defaultAccounts?.commissionRevenue, 'REVENUE', 'Default commission revenue account', session)
  const amountMinor = minor(invoice.total)
  const taxAmountMinor = minor(invoice.taxAmount || 0, 'tax amount')
  if (taxAmountMinor > amountMinor) throw new ApiError(httpStatus.CONFLICT, 'Invoice tax amount cannot exceed invoice total')
  const revenueMinor = amountMinor - taxAmountMinor
  const dimensions = { propertyId: propertyDimension(invoice.propertyId) }
  const lines: FinanceJournalLineInput[] = [
    { accountId: String(ar._id), debitMinor: amountMinor, description: invoice.clientName || invoice.invoiceNumber, ...dimensions },
    { accountId: String(revenue._id), creditMinor: revenueMinor, description: invoice.clientName || invoice.invoiceNumber, ...dimensions },
  ]
  if (taxAmountMinor > 0) {
    let taxAccountRef: unknown = settings.taxAccounts?.outputTax
    if (invoice.taxCodeId) {
      const tax = await withSession(FinanceTaxCode.findOne({ _id: invoice.taxCodeId, organizationId, status: 'ACTIVE', direction: 'OUTPUT' }), session).lean()
      if (!tax) throw new ApiError(httpStatus.CONFLICT, 'Invoice output tax code is no longer valid')
      taxAccountRef = tax.outputAccountId || taxAccountRef
    }
    const taxAccount = await accountFromRef(organizationId, taxAccountRef, 'LIABILITY', 'Output tax account', session)
    lines.push({ accountId: String(taxAccount._id), creditMinor: taxAmountMinor, description: `${invoice.invoiceNumber} output tax`, ...dimensions })
  }
  return postAutomaticJournal(organizationId, actor, {
    sourceType: 'INVOICE_REVENUE', sourceId: `${invoice._id}:v${version}`, currency: invoice.currency || 'BDT', postingDate: new Date(invoice.issueDate), description: `Revenue recognized for ${invoice.invoiceNumber}`, reference: invoice.invoiceNumber,
    lines,
  }, session)
}

const postInvoicePayment = async (organizationId: string, actor: AccountingActor, invoice: any, transaction: any, session?: ClientSession) => {
  const settings = await getSettings(organizationId, session)
  const bank = await bankGlAccount(organizationId, transaction.bankAccountId, settings.defaultAccounts?.bank, session)
  const ar = await accountFromRef(organizationId, settings.defaultAccounts?.accountsReceivable, 'ASSET', 'Accounts Receivable account', session)
  const amountMinor = minor(transaction.amount)
  const dimensions = { propertyId: propertyDimension(invoice.propertyId) }
  return postAutomaticJournal(organizationId, actor, {
    sourceType: 'INVOICE_PAYMENT', sourceId: String(transaction._id), currency: transaction.currency || invoice.currency || 'BDT', postingDate: new Date(transaction.transactionDate), description: `Payment received for ${invoice.invoiceNumber}`, reference: transaction.reference || invoice.invoiceNumber,
    lines: [
      { accountId: String(bank._id), debitMinor: amountMinor, description: invoice.invoiceNumber, ...dimensions },
      { accountId: String(ar._id), creditMinor: amountMinor, description: invoice.invoiceNumber, ...dimensions },
    ],
  }, session)
}

const postCommissionAccrual = async (organizationId: string, actor: AccountingActor, commission: any, version: number, session?: ClientSession) => {
  if (commission.status !== 'approved' || Number(commission.agentShare || 0) <= 0) return null
  const settings = await getSettings(organizationId, session)
  const expense = await accountFromRef(organizationId, settings.defaultAccounts?.commissionExpense, 'EXPENSE', 'Commission expense account', session)
  const payable = await accountFromRef(organizationId, settings.defaultAccounts?.commissionPayable, 'LIABILITY', 'Commission payable account', session)
  const amountMinor = minor(commission.agentShare, 'agent share')
  const dimensions = { propertyId: propertyDimension(commission.propertyId), agentId: id(commission.agentId) }
  return postAutomaticJournal(organizationId, actor, {
    sourceType: 'COMMISSION_ACCRUAL', sourceId: `${commission._id}:v${version}`, currency: commission.currency || 'BDT', postingDate: new Date(commission.updatedAt || commission.createdAt || new Date()), description: `Agent commission accrued ${commission.commissionNumber}`, reference: commission.dealReference || commission.commissionNumber,
    lines: [
      { accountId: String(expense._id), debitMinor: amountMinor, description: commission.commissionNumber, ...dimensions },
      { accountId: String(payable._id), creditMinor: amountMinor, description: commission.commissionNumber, ...dimensions },
    ],
  }, session)
}

const postCommissionPayout = async (organizationId: string, actor: AccountingActor, commission: any, transaction: any, session?: ClientSession) => {
  if (Number(commission.agentShare || 0) <= 0) return null
  const settings = await getSettings(organizationId, session)
  const payable = await accountFromRef(organizationId, settings.defaultAccounts?.commissionPayable, 'LIABILITY', 'Commission payable account', session)
  const bank = await bankGlAccount(organizationId, transaction?.bankAccountId, settings.defaultAccounts?.bank, session)
  const amountMinor = minor(commission.agentShare, 'agent share')
  const dimensions = { propertyId: propertyDimension(commission.propertyId), agentId: id(commission.agentId) }
  return postAutomaticJournal(organizationId, actor, {
    sourceType: 'COMMISSION_PAYOUT', sourceId: String(transaction?._id || commission._id), currency: transaction?.currency || commission.currency || 'BDT', postingDate: new Date(commission.paidAt || transaction?.transactionDate || new Date()), description: `Agent commission paid ${commission.commissionNumber}`, reference: commission.paymentReference || commission.commissionNumber,
    lines: [
      { accountId: String(payable._id), debitMinor: amountMinor, description: commission.commissionNumber, ...dimensions },
      { accountId: String(bank._id), creditMinor: amountMinor, description: commission.commissionNumber, ...dimensions },
    ],
  }, session)
}

export const FinanceGlIntegrationService = {
  isAutomaticPostingReady,
  postManualTransaction,
  postInvoiceRevenue,
  postInvoicePayment,
  postCommissionAccrual,
  postCommissionPayout,
  reverseLinkedJournal,
}
