import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { FinanceTransaction, FinanceInvoice, FinanceCommission, FinanceVendor, FinanceBudget } from './finance.model'
import { FinanceBankAccount, FinanceVendorBill } from './financeOperations.model'
import { FinanceAccount, FinanceCategoryAccountMapping, FinanceFiscalPeriod, FinanceJournalEntry } from './financeAccounting.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccountingInitialization, FinanceLegacyPaymentMethodMapping } from './financeInitialization.model'
import type { AccountingActor, FinanceJournalLineInput } from './financeAccounting.interface'
import type { LegacyFinancePaymentMethod } from './financeInitialization.interface'
import { FinanceAccountingService } from './financeAccounting.service'
import { FinanceReportingService } from './financeReporting.service'
import { moneyToMinorUnits } from './finance.money'
import { assertLegacyFinanceCurrency, FINANCE_ERROR_CODES } from './finance.contract'

const objectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}
const actorObjectId = (actor: AccountingActor) => objectId(actor.id, 'authenticated user')
const asDate = (value: unknown, label: string) => {
  const d = value instanceof Date ? new Date(value) : new Date(String(value || ''))
  if (Number.isNaN(d.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
const withSession = <T>(query: T, session?: ClientSession): T => {
  if (session && typeof (query as any)?.session === 'function') (query as any).session(session)
  return query
}
const audit = (organizationId: string, actor: AccountingActor, action: string, entityType: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) =>
  writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)

const getMappings = async (organizationId: string) => FinanceLegacyPaymentMethodMapping.find({ organizationId }).sort({ paymentMethod: 1 }).populate('bankAccountId', 'name type currency glAccountId status').lean()

const setPaymentMethodMapping = async (organizationId: string, actor: AccountingActor, input: { paymentMethod: LegacyFinancePaymentMethod; bankAccountId: string }) => FinanceAccountingService.accountingTransaction(async (session) => {
  const bank = await withSession(FinanceBankAccount.findOne({ _id: objectId(input.bankAccountId, 'bank account id'), organizationId, status: 'ACTIVE' }), session).lean()
  if (!bank) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank/cash account does not belong to this organization or is inactive')
  const before = await withSession(FinanceLegacyPaymentMethodMapping.findOne({ organizationId, paymentMethod: input.paymentMethod }), session).lean()
  const row = await FinanceLegacyPaymentMethodMapping.findOneAndUpdate(
    { organizationId, paymentMethod: input.paymentMethod },
    { $set: { bankAccountId: bank._id, updatedBy: actorObjectId(actor) }, $setOnInsert: { organizationId, paymentMethod: input.paymentMethod, createdBy: actorObjectId(actor) } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, session },
  ).lean()
  if (!row) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to save payment-method mapping')
  await audit(organizationId, actor, 'finance.accounting_migration_payment_mapping_updated', 'financeLegacyPaymentMethodMapping', String(row._id), 'Legacy payment method mapped to finance bank/cash account', { before: before ? { paymentMethod: before.paymentMethod, bankAccountId: String(before.bankAccountId) } : null, after: { paymentMethod: row.paymentMethod, bankAccountId: String(row.bankAccountId) } }, session)
  return row
})

const historicalSnapshot = async (organizationId: string, startDate: Date) => {
  const [transactions, invoices, commissions, bills, vendors, budgets, categoryMappings, paymentMappings, period] = await Promise.all([
    FinanceTransaction.find({ organizationId, transactionDate: { $lt: startDate }, status: 'paid', deletedAt: null }).select('type category amount paymentMethod transactionDate sourceType').lean(),
    FinanceInvoice.find({ organizationId, issueDate: { $lt: startDate }, archivedAt: null, status: { $nin: ['draft', 'cancelled'] } }).select('invoiceNumber total payments issueDate status').lean(),
    FinanceCommission.find({ organizationId, createdAt: { $lt: startDate }, archivedAt: null, status: { $in: ['approved', 'paid'] } }).select('commissionNumber agentShare status paidAt createdAt').lean(),
    FinanceVendorBill.find({ organizationId, billDate: { $lt: startDate }, status: { $in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } }).select('billNumber totalMinor payments billDate status').lean(),
    FinanceVendor.countDocuments({ organizationId, archivedAt: null }),
    FinanceBudget.countDocuments({ organizationId, archivedAt: null }),
    FinanceCategoryAccountMapping.find({ organizationId }).select('transactionType categoryKey accountId').lean(),
    FinanceLegacyPaymentMethodMapping.find({ organizationId }).select('paymentMethod bankAccountId').lean(),
    FinanceFiscalPeriod.findOne({ organizationId, startDate: { $lte: startDate }, endDate: { $gte: startDate } }).select('_id fiscalYearId name status').lean(),
  ])

  const arMinor = invoices.reduce((sum: number, invoice: any) => {
    const paid = (invoice.payments || []).filter((p: any) => new Date(p.paidAt) < startDate).reduce((n: number, p: any) => n + moneyToMinorUnits(p.amount, 'invoice payment'), 0)
    return sum + Math.max(0, moneyToMinorUnits(invoice.total, 'invoice total') - paid)
  }, 0)
  const commissionPayableMinor = commissions.reduce((sum: number, row: any) => {
    const paidBefore = row.paidAt && new Date(row.paidAt) < startDate
    return sum + (paidBefore ? 0 : moneyToMinorUnits(row.agentShare, 'commission agent share'))
  }, 0)
  const apMinor = bills.reduce((sum: number, bill: any) => {
    const paid = (bill.payments || []).filter((p: any) => new Date(p.paidAt) < startDate).reduce((n: number, p: any) => n + Number(p.amountMinor || 0), 0)
    return sum + Math.max(0, Number(bill.totalMinor || 0) - paid)
  }, 0)

  const paymentMethodNet: Record<string, number> = {}
  const paymentMethodCounts: Record<string, number> = {}
  const categoryKeys = new Set<string>()
  const categoryDetails = new Map<string, { transactionType: string; category: string }>()
  for (const tx of transactions as any[]) {
    const amount = moneyToMinorUnits(tx.amount, 'transaction amount') * (tx.type === 'income' ? 1 : -1)
    paymentMethodNet[tx.paymentMethod] = Number(paymentMethodNet[tx.paymentMethod] || 0) + amount
    paymentMethodCounts[tx.paymentMethod] = Number(paymentMethodCounts[tx.paymentMethod] || 0) + 1
    if (tx.sourceType === 'manual') {
      const key = `${tx.type}:${String(tx.category || '').trim().toLowerCase()}`
      categoryKeys.add(key)
      categoryDetails.set(key, { transactionType: tx.type, category: tx.category })
    }
  }
  const mappedCategories = new Set((categoryMappings as any[]).map((m) => `${m.transactionType}:${m.categoryKey}`))
  const mappedMethods = new Map((paymentMappings as any[]).map((m) => [m.paymentMethod, String(m.bankAccountId)]))
  const unmappedCategories = [...categoryKeys].filter((key) => !mappedCategories.has(key)).map((key) => categoryDetails.get(key))
  const usedMethods = Object.keys(paymentMethodCounts)
  const unmappedPaymentMethods = usedMethods.filter((method) => !mappedMethods.has(method))
  const suggestedByBank = new Map<string, number>()
  for (const method of usedMethods) {
    const bankId = mappedMethods.get(method)
    if (!bankId) continue
    suggestedByBank.set(bankId, Number(suggestedByBank.get(bankId) || 0) + Number(paymentMethodNet[method] || 0))
  }

  return {
    accountingStartDate: startDate,
    sourceCounts: { transactions: transactions.length, invoices: invoices.length, commissions: commissions.length, vendorBills: bills.length, vendors, budgets },
    outstanding: { accountsReceivableMinor: arMinor, accountsPayableMinor: apMinor, commissionPayableMinor },
    paymentMethods: usedMethods.map((paymentMethod) => ({ paymentMethod, count: paymentMethodCounts[paymentMethod], suggestedNetMovementMinor: paymentMethodNet[paymentMethod], bankAccountId: mappedMethods.get(paymentMethod) || null })),
    suggestedBankOpeningBalances: [...suggestedByBank.entries()].map(([bankAccountId, balanceMinor]) => ({ bankAccountId, balanceMinor })),
    unmappedPaymentMethods,
    unmappedCategories,
    fiscalPeriod: period ? { _id: String(period._id), fiscalYearId: String(period.fiscalYearId), name: period.name, status: period.status } : null,
    ready: Boolean(period) && unmappedPaymentMethods.length === 0 && unmappedCategories.length === 0,
  }
}

const preview = async (organizationId: string, actor: AccountingActor, startDateInput: unknown) => {
  const startDate = asDate(startDateInput, 'accounting start date')
  const tomorrow = new Date(); tomorrow.setUTCHours(0, 0, 0, 0); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (startDate >= tomorrow) throw new ApiError(httpStatus.BAD_REQUEST, 'Accounting start date cannot be in the future')
  const settings: any = await FinanceAccountingSettings.findOne({ organizationId }).lean()
  if (!settings?.initializedAt) throw new ApiError(httpStatus.CONFLICT, 'Initialize the Chart of Accounts before preparing historical migration', '', FINANCE_ERROR_CODES.notInitialized)
  assertLegacyFinanceCurrency(settings.baseCurrency, 'Organization accounting base currency')
  const existingOpening = await FinanceJournalEntry.findOne({ organizationId, sourceType: 'OPENING_BALANCE_MIGRATION', sourceId: `MIGRATION:${organizationId}` }).lean()
  if (existingOpening) return { alreadyActivated: true, openingJournalId: String(existingOpening._id), snapshot: await historicalSnapshot(organizationId, startDate) }
  const nonMigrationPosted = await FinanceJournalEntry.exists({ organizationId, status: { $in: ['POSTED', 'REVERSED'] }, sourceType: { $nin: ['OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION'] } })
  if (nonMigrationPosted) throw new ApiError(httpStatus.CONFLICT, 'Historical migration cannot be started after live General Ledger activity exists. Use opening/adjustment journals instead.', '', 'ACCOUNTING_ALREADY_LIVE')
  const snapshot = await historicalSnapshot(organizationId, startDate)
  const actorId = actorObjectId(actor)
  const batch = await FinanceAccountingInitialization.findOneAndUpdate(
    { organizationId },
    { $set: { status: 'PREVIEWED', accountingStartDate: startDate, lastPreviewAt: new Date(), previewSnapshot: snapshot, updatedBy: actorId }, $setOnInsert: { organizationId, createdBy: actorId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean()
  await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { activationStatus: 'MIGRATION_REQUIRED', updatedBy: actor.id } })
  await audit(organizationId, actor, 'finance.accounting_migration_previewed', 'financeAccountingInitialization', String(batch?._id || organizationId), 'Historical finance migration preview generated', { accountingStartDate: startDate, ready: snapshot.ready, sourceCounts: snapshot.sourceCounts, outstanding: snapshot.outstanding })
  return { batch, snapshot }
}

const accountById = async (organizationId: string, id: unknown, expectedTypes: string[], label: string, session?: ClientSession) => {
  const row = await withSession(FinanceAccount.findOne({ _id: objectId(id, label), organizationId, status: 'ACTIVE' }), session).lean()
  if (!row || !expectedTypes.includes(row.type)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} is invalid, inactive, or has the wrong account type`)
  return row as any
}
const accountByRef = async (organizationId: string, id: unknown, expectedTypes: string[], label: string, session?: ClientSession) => {
  if (!id) throw new ApiError(httpStatus.CONFLICT, `${label} is not configured in Accounting Settings`)
  return accountById(organizationId, id, expectedTypes, label, session)
}
const normalSideLine = (account: any, amountMinor: number, description: string): FinanceJournalLineInput => account.normalBalance === 'CREDIT'
  ? { accountId: String(account._id), creditMinor: amountMinor, description }
  : { accountId: String(account._id), debitMinor: amountMinor, description }

const activate = async (organizationId: string, actor: AccountingActor, input: any) => {
  const startDate = asDate(input.accountingStartDate, 'accounting start date')
  const actorId = actorObjectId(actor)
  const existingBeforeLock: any = await FinanceAccountingInitialization.findOne({ organizationId }).lean()
  if (existingBeforeLock?.status === 'ACTIVATED') {
    const journal = existingBeforeLock.openingJournalId ? await FinanceAccountingService.getJournal(organizationId, String(existingBeforeLock.openingJournalId)) : null
    const trialBalance = await FinanceReportingService.trialBalance(organizationId, { startDate, endDate: startDate })
    return { batch: existingBeforeLock, journal, idempotent: true, trialBalance: { balanced: trialBalance.balanced, totals: trialBalance.totals } }
  }
  if (existingBeforeLock?.status === 'ACTIVATING') throw new ApiError(httpStatus.CONFLICT, 'Accounting migration activation is already in progress', '', FINANCE_ERROR_CODES.migrationInProgress)
  if (!existingBeforeLock || existingBeforeLock.status !== 'PREVIEWED') throw new ApiError(httpStatus.CONFLICT, 'Preview and reconcile historical finance before activating accounting', '', 'ACCOUNTING_MIGRATION_PREVIEW_REQUIRED')

  const lock = await FinanceAccountingInitialization.findOneAndUpdate(
    { _id: existingBeforeLock._id, organizationId, status: 'PREVIEWED' },
    { $set: { status: 'ACTIVATING', accountingStartDate: startDate, updatedBy: actorId } },
    { new: true, runValidators: true },
  ).lean()
  if (!lock) throw new ApiError(httpStatus.CONFLICT, 'Accounting migration activation state changed. Refresh and retry.', '', 'ACCOUNTING_MIGRATION_CONFLICT')

  try {
    const result = await FinanceAccountingService.accountingTransaction(async (session) => {
      const settings: any = await withSession(FinanceAccountingSettings.findOne({ organizationId }), session).lean()
      if (!settings?.initializedAt) throw new ApiError(httpStatus.CONFLICT, 'Initialize the Chart of Accounts before activating accounting', '', FINANCE_ERROR_CODES.notInitialized)
      assertLegacyFinanceCurrency(settings.baseCurrency, 'Organization accounting base currency')
      const existingBatch: any = await withSession(FinanceAccountingInitialization.findOne({ organizationId }), session).lean()
      if (existingBatch?.status === 'ACTIVATED') return { batch: existingBatch, journal: existingBatch.openingJournalId ? await FinanceAccountingService.getJournal(organizationId, String(existingBatch.openingJournalId), session) : null, idempotent: true }
      if (existingBatch?.status !== 'ACTIVATING') throw new ApiError(httpStatus.CONFLICT, 'Accounting migration activation lock was lost', '', 'ACCOUNTING_MIGRATION_CONFLICT')

      // The ACTIVATING state is committed before this snapshot. Basic Finance
      // mutations are rejected by middleware while this runs, so the opening
      // balances cannot race with an invoice/payment/commission written between
      // the snapshot and activation commit.
      const snapshot = await historicalSnapshot(organizationId, startDate)
      if (!snapshot.fiscalPeriod) throw new ApiError(httpStatus.CONFLICT, 'Create a fiscal year/period covering the accounting start date before activation')
      if (snapshot.unmappedPaymentMethods.length) throw new ApiError(httpStatus.CONFLICT, `Map legacy payment methods before activation: ${snapshot.unmappedPaymentMethods.join(', ')}`, '', 'ACCOUNTING_PAYMENT_MAPPINGS_REQUIRED')
      if (snapshot.unmappedCategories.length) throw new ApiError(httpStatus.CONFLICT, 'Map all historical manual finance categories before activation', '', 'ACCOUNTING_CATEGORY_MAPPINGS_REQUIRED', { categories: snapshot.unmappedCategories })

      const ar = await accountByRef(organizationId, settings.defaultAccounts?.accountsReceivable, ['ASSET'], 'Accounts Receivable account', session)
      const ap = await accountByRef(organizationId, settings.defaultAccounts?.accountsPayable, ['LIABILITY'], 'Accounts Payable account', session)
      const commissionPayable = await accountByRef(organizationId, settings.defaultAccounts?.commissionPayable, ['LIABILITY'], 'Commission Payable account', session)
      const retained = await accountByRef(organizationId, settings.defaultAccounts?.retainedEarnings, ['EQUITY'], 'Retained Earnings account', session)
      const lines: FinanceJournalLineInput[] = []
      const seenBanks = new Set<string>()
      for (const item of input.bankOpeningBalances || []) {
        const bankId = String(item.bankAccountId)
        if (seenBanks.has(bankId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Each opening bank/cash account may appear only once')
        seenBanks.add(bankId)
        const bank: any = await withSession(FinanceBankAccount.findOne({ _id: objectId(bankId, 'bank account id'), organizationId, status: 'ACTIVE' }), session).lean()
        if (!bank) throw new ApiError(httpStatus.BAD_REQUEST, 'Opening bank/cash account is invalid or inactive')
        const gl = await accountById(organizationId, bank.glAccountId, ['ASSET', 'LIABILITY'], 'bank General Ledger account', session)
        const amount = Number(item.balanceMinor || 0)
        if (!Number.isSafeInteger(amount)) throw new ApiError(httpStatus.BAD_REQUEST, 'Opening bank balance must be an integer minor-unit amount')
        if (amount > 0) lines.push(normalSideLine(gl, amount, `Opening balance · ${bank.name}`))
        else if (amount < 0) lines.push(gl.normalBalance === 'CREDIT' ? { accountId: String(gl._id), debitMinor: Math.abs(amount), description: `Opening negative balance · ${bank.name}` } : { accountId: String(gl._id), creditMinor: Math.abs(amount), description: `Opening negative balance · ${bank.name}` })
      }
      if (snapshot.outstanding.accountsReceivableMinor > 0) lines.push({ accountId: String(ar._id), debitMinor: snapshot.outstanding.accountsReceivableMinor, description: 'Opening Accounts Receivable' })
      if (snapshot.outstanding.accountsPayableMinor > 0) lines.push({ accountId: String(ap._id), creditMinor: snapshot.outstanding.accountsPayableMinor, description: 'Opening Accounts Payable' })
      if (snapshot.outstanding.commissionPayableMinor > 0) lines.push({ accountId: String(commissionPayable._id), creditMinor: snapshot.outstanding.commissionPayableMinor, description: 'Opening Agent Commission Payable' })
      for (const item of input.openingLiabilities || []) {
        if (!Number(item.amountMinor || 0)) continue
        const account = await accountById(organizationId, item.accountId, ['LIABILITY'], 'opening liability account', session)
        lines.push(normalSideLine(account, Number(item.amountMinor), String(item.description)))
      }
      for (const item of input.openingEquity || []) {
        if (!Number(item.amountMinor || 0)) continue
        const account = await accountById(organizationId, item.accountId, ['EQUITY'], 'opening equity account', session)
        lines.push(normalSideLine(account, Number(item.amountMinor), String(item.description)))
      }
      let debit = lines.reduce((n, l) => n + Number(l.debitMinor || 0), 0)
      let credit = lines.reduce((n, l) => n + Number(l.creditMinor || 0), 0)
      const retainedAdjustmentMinor = debit - credit
      if (retainedAdjustmentMinor > 0) lines.push({ accountId: String(retained._id), creditMinor: retainedAdjustmentMinor, description: 'Opening retained earnings / migration balancing balance' })
      if (retainedAdjustmentMinor < 0) lines.push({ accountId: String(retained._id), debitMinor: Math.abs(retainedAdjustmentMinor), description: 'Opening accumulated deficit / migration balancing balance' })
      debit = lines.reduce((n, l) => n + Number(l.debitMinor || 0), 0)
      credit = lines.reduce((n, l) => n + Number(l.creditMinor || 0), 0)
      if (debit !== credit) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Opening migration journal is not balanced', '', FINANCE_ERROR_CODES.unbalanced)

      let journal: any = null
      if (lines.length >= 2 && debit > 0) {
        const draft = await FinanceAccountingService.createJournalDraftInternal(organizationId, { ...actor, system: true }, {
          entryDate: startDate, postingDate: startDate, description: 'Accounting migration opening balances', reference: 'ACCOUNTING-MIGRATION', lines,
        }, { sourceType: 'OPENING_BALANCE_MIGRATION', sourceId: `MIGRATION:${organizationId}`, idempotencyKey: `accounting-migration:${organizationId}` }, session)
        journal = await FinanceAccountingService.postJournalInternal(organizationId, { ...actor, system: true }, String(draft._id), session)
      }
      const batch = await FinanceAccountingInitialization.findOneAndUpdate(
        { organizationId, status: 'ACTIVATING' },
        { $set: { status: 'ACTIVATED', accountingStartDate: startDate, previewSnapshot: snapshot, openingJournalId: journal?._id || null, activatedAt: new Date(), activatedBy: actorId, activationReason: String(input.reason), updatedBy: actorId } },
        { new: true, runValidators: true, session },
      ).lean()
      if (!batch) throw new ApiError(httpStatus.CONFLICT, 'Accounting migration activation lock was lost', '', 'ACCOUNTING_MIGRATION_CONFLICT')
      await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { activationStatus: 'ACTIVE', accountingStartDate: startDate, activatedAt: new Date(), activatedBy: actor.id, updatedBy: actor.id } }, { session })
      await audit(organizationId, actor, 'finance.accounting_migration_activated', 'financeAccountingInitialization', String(batch._id), String(input.reason), { accountingStartDate: startDate, openingJournalId: journal?._id ? String(journal._id) : null, openingDebitMinor: debit, openingCreditMinor: credit, retainedAdjustmentMinor, sourceCounts: snapshot.sourceCounts, outstanding: snapshot.outstanding }, session)
      return { batch, journal, retainedAdjustmentMinor, idempotent: false }
    })
    const trialBalance = await FinanceReportingService.trialBalance(organizationId, { startDate, endDate: startDate })
    if (!trialBalance.balanced) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Accounting activation completed but Trial Balance is not balanced', '', FINANCE_ERROR_CODES.unbalanced)
    return { ...result, trialBalance: { balanced: trialBalance.balanced, totals: trialBalance.totals } }
  } catch (error) {
    // Release the short migration write lock on failure so legacy/basic Finance can
    // continue. The user can correct mappings/balances and retry the activation.
    await FinanceAccountingInitialization.updateOne(
      { organizationId, status: 'ACTIVATING' },
      { $set: { status: 'PREVIEWED', updatedBy: actorId } },
    ).catch(() => undefined)
    throw error
  }
}

const getStatus = async (organizationId: string) => {
  const [settings, batch, mappings] = await Promise.all([
    FinanceAccountingSettings.findOne({ organizationId }).lean(),
    FinanceAccountingInitialization.findOne({ organizationId }).lean(),
    getMappings(organizationId),
  ])
  return { settings, batch, paymentMethodMappings: mappings, migrationRequired: String(settings?.activationStatus || 'ACTIVE') === 'MIGRATION_REQUIRED' }
}

export const FinanceInitializationService = { getStatus, getMappings, setPaymentMethodMapping, preview, activate, historicalSnapshot }
