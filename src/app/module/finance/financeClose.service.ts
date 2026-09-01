import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit.model'
import { FinanceAccount, FinanceFiscalPeriod, FinanceFiscalYear, FinanceJournalEntry, FinanceJournalLine } from './financeAccounting.model'
import { FinanceBankAccount, FinanceBankStatement } from './financeOperations.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceAccountingService } from './financeAccounting.service'
import { FinanceOperationsService } from './financeOperations.service'
import { FinanceReportingService } from './financeReporting.service'
import type { AccountingActor, FinanceJournalLineInput } from './financeAccounting.interface'
import { FINANCE_ERROR_CODES } from './finance.contract'

const objectId = (value: unknown, label: string) => {
  const id = String(value || '').trim()
  if (!mongoose.isValidObjectId(id)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(id)
}
const actorObjectId = (actor: AccountingActor) => objectId(actor.id, 'authenticated user')
const withSession = <T>(query: T, session?: ClientSession): T => { if (session && typeof (query as any)?.session === 'function') (query as any).session(session); return query }
const audit = (organizationId: string, actor: AccountingActor, action: string, entityType: string, entityId: string, reason: string, metadata: Record<string, unknown> = {}, session?: ClientSession) => writeAudit({ organizationId, actorId: actor.id, actorRole: actor.role || 'tenant', action, entityType, entityId, reason, requestId: actor.requestId, ip: actor.ip, metadata }, session)

const period = async (organizationId: string, id: string, session?: ClientSession) => {
  const row = await withSession(FinanceFiscalPeriod.findOne({ _id: objectId(id, 'fiscal period id'), organizationId }), session).lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal period not found')
  return row as any
}
const year = async (organizationId: string, id: string, session?: ClientSession) => {
  const row = await withSession(FinanceFiscalYear.findOne({ _id: objectId(id, 'fiscal year id'), organizationId }), session).lean()
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal year not found')
  return row as any
}

const bankCloseState = async (organizationId: string, endDate: Date) => {
  const banks: any[] = await FinanceBankAccount.find({ organizationId, status: 'ACTIVE', createdAt: { $lte: endDate } }).select('_id name type createdAt').lean()
  const rows = await Promise.all(banks.map(async (bank) => {
    const reconciled: any = await FinanceBankStatement.findOne({ organizationId, bankAccountId: bank._id, status: 'RECONCILED', endDate: { $gte: endDate } }).sort({ endDate: 1 }).select('_id statementNumber endDate status').lean()
    return { bankAccountId: String(bank._id), name: bank.name, type: bank.type, reconciledThroughPeriodEnd: Boolean(reconciled), statement: reconciled || null }
  }))
  return rows
}

const periodChecklist = async (organizationId: string, periodId: string) => {
  const p = await period(organizationId, periodId)
  const [draftJournals, approvedJournals, bankReconciliation, ar, ap, trialBalance] = await Promise.all([
    FinanceJournalEntry.countDocuments({ organizationId, fiscalPeriodId: p._id, status: 'DRAFT' }),
    FinanceJournalEntry.countDocuments({ organizationId, fiscalPeriodId: p._id, status: 'APPROVED' }),
    bankCloseState(organizationId, new Date(p.endDate)),
    FinanceOperationsService.receivables(organizationId, { asOf: p.endDate }),
    FinanceOperationsService.payables(organizationId, { asOf: p.endDate }),
    FinanceReportingService.trialBalance(organizationId, { startDate: p.startDate, endDate: p.endDate }),
  ])
  const unreconciledBanks = bankReconciliation.filter((row: any) => !row.reconciledThroughPeriodEnd)
  const blockers: string[] = []
  if (draftJournals) blockers.push(`${draftJournals} draft journal(s) remain`)
  if (approvedJournals) blockers.push(`${approvedJournals} approved journal(s) remain unposted`)
  if (unreconciledBanks.length) blockers.push(`${unreconciledBanks.length} bank/cash account(s) are not reconciled through period end`)
  if (!trialBalance.balanced) blockers.push('Trial Balance is not balanced')
  return {
    period: p,
    checks: {
      draftJournals, approvedJournals,
      bankReconciliation, unreconciledBankAccounts: unreconciledBanks,
      accountsReceivable: ar.aging,
      accountsPayable: ap.aging,
      trialBalance: { balanced: trialBalance.balanced, totals: trialBalance.totals },
    },
    blockers,
    canClose: blockers.length === 0,
  }
}

const closePeriod = async (organizationId: string, actor: AccountingActor, periodId: string, reason: string) => {
  const periodObjectId = objectId(periodId, 'fiscal period id')
  const current: any = await FinanceFiscalPeriod.findOne({ _id: periodObjectId, organizationId }).lean()
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal period not found')
  if (current.status === 'CLOSED') return current

  // First review while the period is still usable. If it is clean, atomically
  // soft-lock it. Posting-period resolution rejects SOFT_LOCKED periods, so no
  // journal can race in between the final checklist and the CLOSED transition.
  const firstChecklist = await periodChecklist(organizationId, periodId)
  if (!firstChecklist.canClose) throw new ApiError(httpStatus.CONFLICT, `Period cannot be closed: ${firstChecklist.blockers.join('; ')}`, '', FINANCE_ERROR_CODES.periodClosed, { blockers: firstChecklist.blockers })

  let acquiredLock = false
  if (current.status === 'OPEN') {
    const locked = await FinanceFiscalPeriod.findOneAndUpdate(
      { _id: periodObjectId, organizationId, status: 'OPEN' },
      { $set: { status: 'SOFT_LOCKED', updatedBy: actorObjectId(actor) } },
      { new: true, runValidators: true },
    ).lean()
    if (!locked) {
      const latest: any = await FinanceFiscalPeriod.findOne({ _id: periodObjectId, organizationId }).lean()
      if (latest?.status === 'CLOSED') return latest
      throw new ApiError(httpStatus.CONFLICT, 'Fiscal period changed while the close was starting. Refresh and retry.', '', 'PERIOD_CLOSE_CONFLICT')
    }
    acquiredLock = true
  } else if (current.status !== 'SOFT_LOCKED') {
    throw new ApiError(httpStatus.CONFLICT, `Fiscal period cannot be closed from status ${current.status}`)
  }

  try {
    const finalChecklist = await periodChecklist(organizationId, periodId)
    if (!finalChecklist.canClose) throw new ApiError(httpStatus.CONFLICT, `Period cannot be closed: ${finalChecklist.blockers.join('; ')}`, '', FINANCE_ERROR_CODES.periodClosed, { blockers: finalChecklist.blockers })

    return await FinanceAccountingService.accountingTransaction(async (session) => {
      const p: any = await withSession(FinanceFiscalPeriod.findOne({ _id: periodObjectId, organizationId, status: 'SOFT_LOCKED' }), session)
      if (!p) {
        const latest: any = await withSession(FinanceFiscalPeriod.findOne({ _id: periodObjectId, organizationId }), session).lean()
        if (latest?.status === 'CLOSED') return latest
        throw new ApiError(httpStatus.CONFLICT, 'Fiscal period close lock was lost. Refresh and retry.', '', 'PERIOD_CLOSE_CONFLICT')
      }
      p.status = 'CLOSED'; p.closedAt = new Date(); p.closedBy = actorObjectId(actor); p.updatedBy = actorObjectId(actor)
      await p.save({ session })
      await audit(organizationId, actor, 'finance.period_closed', 'financeFiscalPeriod', String(p._id), reason, { eventCode: 'PERIOD_CLOSED', before: { status: current.status }, after: { status: 'CLOSED' }, checklist: finalChecklist.checks }, session)
      return p.toObject()
    })
  } catch (error) {
    if (acquiredLock) {
      await FinanceFiscalPeriod.updateOne(
        { _id: periodObjectId, organizationId, status: 'SOFT_LOCKED', closedAt: null },
        { $set: { status: 'OPEN', updatedBy: actorObjectId(actor) } },
      ).catch(() => undefined)
    }
    throw error
  }
}

const reopenPeriod = async (organizationId: string, actor: AccountingActor, periodId: string, reason: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const p: any = await withSession(FinanceFiscalPeriod.findOne({ _id: objectId(periodId, 'fiscal period id'), organizationId }), session)
  if (!p) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal period not found')
  if (p.status !== 'CLOSED') throw new ApiError(httpStatus.CONFLICT, 'Only a closed period can be reopened', '', FINANCE_ERROR_CODES.periodClosed)
  const y: any = await withSession(FinanceFiscalYear.findOne({ _id: p.fiscalYearId, organizationId }), session).lean()
  if (y?.status === 'CLOSED') throw new ApiError(httpStatus.CONFLICT, 'This period belongs to a closed fiscal year. Year-end closing must be addressed before reopening the period.', '', FINANCE_ERROR_CODES.periodClosed)
  p.status = 'OPEN'; p.closedAt = null; p.closedBy = null; p.updatedBy = actorObjectId(actor)
  await p.save({ session })
  await audit(organizationId, actor, 'finance.period_reopened', 'financeFiscalPeriod', String(p._id), reason, { eventCode: 'PERIOD_REOPENED', before: { status: 'CLOSED' }, after: { status: 'OPEN' } }, session)
  return p.toObject()
})

const accountBySystemKey = async (organizationId: string, systemKey: string, session?: ClientSession) => {
  const row = await withSession(FinanceAccount.findOne({ organizationId, systemKey, status: 'ACTIVE' }), session).lean()
  if (!row) throw new ApiError(httpStatus.CONFLICT, `${systemKey} account is missing or inactive`, '', FINANCE_ERROR_CODES.invalidAccountMapping)
  return row as any
}

const yearEndClose = async (organizationId: string, actor: AccountingActor, fiscalYearId: string, reason: string) => FinanceAccountingService.accountingTransaction(async (session) => {
  const y: any = await withSession(FinanceFiscalYear.findOne({ _id: objectId(fiscalYearId, 'fiscal year id'), organizationId }), session)
  if (!y) throw new ApiError(httpStatus.NOT_FOUND, 'Fiscal year not found')
  if (y.status === 'CLOSED') {
    const existing = await withSession(FinanceJournalEntry.find({ organizationId, sourceId: `FY:${String(y._id)}`, sourceType: { $in: ['YEAR_END_CLOSE_PNL', 'YEAR_END_TRANSFER_EARNINGS'] } }).sort({ sourceType: 1 }), session).lean()
    return { fiscalYear: y.toObject(), closingJournals: existing, idempotent: true }
  }
  const periods: any[] = await withSession(FinanceFiscalPeriod.find({ organizationId, fiscalYearId: y._id }).sort({ periodNumber: 1 }), session).lean()
  if (!periods.length || periods.some((p) => p.status !== 'CLOSED')) throw new ApiError(httpStatus.CONFLICT, 'Close every fiscal period before running year-end closing', '', 'FISCAL_YEAR_PERIODS_OPEN')
  const outstandingJournals = await withSession(FinanceJournalEntry.countDocuments({ organizationId, fiscalYearId: y._id, status: { $in: ['DRAFT', 'APPROVED'] } }), session)
  if (outstandingJournals) throw new ApiError(httpStatus.CONFLICT, `${outstandingJournals} draft/approved journal(s) remain in this fiscal year`)

  y.status = 'CLOSING'; y.updatedBy = actorObjectId(actor); await y.save({ session })
  const pnlAccounts: any[] = await withSession(FinanceAccount.find({ organizationId, type: { $in: ['REVENUE', 'EXPENSE'] } }).sort({ code: 1 }), session).lean()
  const ids = pnlAccounts.map((a) => a._id)
  let balances: any[] = []
  if (ids.length) {
    const aggregate = FinanceJournalLine.aggregate([
      { $match: { organizationId, accountId: { $in: ids }, journalStatus: { $in: ['POSTED', 'REVERSED'] }, postingDate: { $gte: y.startDate, $lte: y.endDate } } },
      { $group: { _id: '$accountId', debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
    ])
    if (session) aggregate.session(session)
    balances = await aggregate
  }
  const balanceMap = new Map(balances.map((b) => [String(b._id), { debit: Number(b.debitMinor || 0), credit: Number(b.creditMinor || 0) }]))
  const pnlLines: FinanceJournalLineInput[] = []
  for (const account of pnlAccounts) {
    const b = balanceMap.get(String(account._id)) || { debit: 0, credit: 0 }
    const signed = b.debit - b.credit
    if (signed > 0) pnlLines.push({ accountId: String(account._id), creditMinor: signed, description: `Year-end close · ${account.code} ${account.name}` })
    else if (signed < 0) pnlLines.push({ accountId: String(account._id), debitMinor: Math.abs(signed), description: `Year-end close · ${account.code} ${account.name}` })
  }
  const currentEarnings = await accountBySystemKey(organizationId, 'CURRENT_YEAR_EARNINGS', session)
  const retained = await accountBySystemKey(organizationId, 'RETAINED_EARNINGS', session)
  let debit = pnlLines.reduce((n, l) => n + Number(l.debitMinor || 0), 0)
  let credit = pnlLines.reduce((n, l) => n + Number(l.creditMinor || 0), 0)
  const netIncomeMinor = debit - credit
  if (netIncomeMinor > 0) pnlLines.push({ accountId: String(currentEarnings._id), creditMinor: netIncomeMinor, description: 'Current year earnings · net profit' })
  else if (netIncomeMinor < 0) pnlLines.push({ accountId: String(currentEarnings._id), debitMinor: Math.abs(netIncomeMinor), description: 'Current year earnings · net loss' })

  let pnlJournal: any = null
  let transferJournal: any = null
  if (pnlLines.length >= 2) {
    const pnlDraft = await FinanceAccountingService.createJournalDraftInternal(organizationId, { ...actor, system: true }, { entryDate: y.endDate, postingDate: y.endDate, description: `Year-end P&L closing · ${y.name}`, reference: y.name, lines: pnlLines }, { sourceType: 'YEAR_END_CLOSE_PNL', sourceId: `FY:${String(y._id)}`, idempotencyKey: `YEAR_END_CLOSE_PNL:${String(y._id)}`, allowClosedPeriod: true }, session)
    pnlJournal = await FinanceAccountingService.postJournalInternal(organizationId, { ...actor, system: true }, String(pnlDraft._id), session)
    const transferLines: FinanceJournalLineInput[] = netIncomeMinor > 0
      ? [{ accountId: String(currentEarnings._id), debitMinor: netIncomeMinor, description: 'Transfer current year profit' }, { accountId: String(retained._id), creditMinor: netIncomeMinor, description: 'Transfer current year profit to retained earnings' }]
      : netIncomeMinor < 0
        ? [{ accountId: String(retained._id), debitMinor: Math.abs(netIncomeMinor), description: 'Transfer current year loss to retained earnings' }, { accountId: String(currentEarnings._id), creditMinor: Math.abs(netIncomeMinor), description: 'Transfer current year loss' }]
        : []
    if (transferLines.length) {
      const transferDraft = await FinanceAccountingService.createJournalDraftInternal(organizationId, { ...actor, system: true }, { entryDate: y.endDate, postingDate: y.endDate, description: `Transfer current year earnings to retained earnings · ${y.name}`, reference: y.name, lines: transferLines }, { sourceType: 'YEAR_END_TRANSFER_EARNINGS', sourceId: `FY:${String(y._id)}`, idempotencyKey: `YEAR_END_TRANSFER_EARNINGS:${String(y._id)}`, allowClosedPeriod: true }, session)
      transferJournal = await FinanceAccountingService.postJournalInternal(organizationId, { ...actor, system: true }, String(transferDraft._id), session)
    }
  }
  y.status = 'CLOSED'; y.closedAt = new Date(); y.closedBy = actorObjectId(actor); y.updatedBy = actorObjectId(actor); await y.save({ session })
  await audit(organizationId, actor, 'finance.fiscal_year_closed', 'financeFiscalYear', String(y._id), reason, { eventCode: 'FISCAL_YEAR_CLOSED', netIncomeMinor, pnlJournalId: pnlJournal?._id ? String(pnlJournal._id) : null, retainedEarningsTransferJournalId: transferJournal?._id ? String(transferJournal._id) : null, before: { status: 'OPEN' }, after: { status: 'CLOSED' } }, session)
  return { fiscalYear: y.toObject(), netIncomeMinor, closingJournals: [pnlJournal, transferJournal].filter(Boolean), idempotent: false }
})

const auditLog = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const page = Math.max(1, Number(query.page || 1)); const limit = Math.min(100, Math.max(1, Number(query.limit || 30)))
  const where: Record<string, any> = { organizationId, action: query.action ? String(query.action) : { $regex: '^finance\\.' } }
  const [data, total] = await Promise.all([
    AuditEvent.find(where).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditEvent.countDocuments(where),
  ])
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }
}

export const FinanceCloseService = { periodChecklist, closePeriod, reopenPeriod, yearEndClose, auditLog }
