import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import ApiError from '../../../errors/ApiError'
import { FinanceAccount, FinanceCategoryAccountMapping, FinanceJournalEntry, FinanceJournalLine } from './financeAccounting.model'
import { FinanceAccountingSettings } from './financeAccountingSettings.model'
import { FinanceBudget, FinanceInvoice } from './finance.model'
import { FinanceBankAccount, FinanceTaxCode, FinanceVendorBill } from './financeOperations.model'
import { FinanceEquityTransaction } from './financeCapital.model'
import { FinanceOperationsService } from './financeOperations.service'
import { FinanceAccountingService } from './financeAccounting.service'
import { Property } from '../property/property.model'
import { Organization } from '../organization/organization.model'
import type { FinanceReportExport, FinanceReportExportFormat, FinanceReportKey } from './financeReporting.interface'
import { moneyFromMinorUnits, moneyToMinorUnits } from './finance.money'
import { assertLegacyFinanceCurrency, FINANCE_ERROR_CODES } from './finance.contract'

const POSTED_LINE_STATUSES = ['POSTED', 'REVERSED']

const objectId = (value: unknown, label: string) => {
  const text = String(value || '').trim()
  if (!mongoose.isValidObjectId(text)) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return new mongoose.Types.ObjectId(text)
}
const dateValue = (value: unknown, label: string, fallback?: Date) => {
  if ((value === undefined || value === null || value === '') && fallback) return new Date(fallback)
  const date = value instanceof Date ? new Date(value) : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${label}`)
  return date
}
const inclusiveEnd = (value: unknown, fallback = new Date()) => {
  const raw = String(value || '').trim()
  const date = dateValue(value, 'end date', fallback)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date.setUTCHours(23, 59, 59, 999)
  return date
}
const startOfDay = (value: unknown) => {
  const d = dateValue(value, 'start date')
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())) d.setUTCHours(0, 0, 0, 0)
  return d
}
const normalizeRange = (query: Record<string, unknown>, requireStart = true) => {
  const endDate = inclusiveEnd(query.endDate || query.asOf || new Date())
  const startDate = query.startDate ? startOfDay(query.startDate) : undefined
  if (requireStart && !startDate) {
    const first = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1))
    if (first > endDate) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid report date range')
    return { startDate: first, endDate }
  }
  if (startDate && startDate > endDate) throw new ApiError(httpStatus.BAD_REQUEST, 'Start date cannot be after end date')
  return { startDate, endDate }
}
const ensureInitialized = async (organizationId: string) => {
  const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean()
  if (!settings?.initializedAt) throw new ApiError(httpStatus.CONFLICT, 'Initialize Advanced Accounting before running financial statements', '', FINANCE_ERROR_CODES.notInitialized)
  assertLegacyFinanceCurrency(settings.baseCurrency, 'Organization accounting base currency')
  return settings
}
const money = (minor: number, currency: string) => `${currency} ${moneyFromMinorUnits(minor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const accountBalanceForType = (type: string, debit: number, credit: number) => type === 'ASSET' || type === 'EXPENSE' ? debit - credit : credit - debit
const periodMatch = (organizationId: string, startDate: Date | undefined, endDate: Date) => ({
  organizationId,
  journalStatus: { $in: POSTED_LINE_STATUSES },
  postingDate: { ...(startDate ? { $gte: startDate } : {}), $lte: endDate },
})

const aggregateAccountActivity = async (organizationId: string, startDate: Date | undefined, endDate: Date) => FinanceJournalLine.aggregate([
  { $match: periodMatch(organizationId, startDate, endDate) },
  { $group: { _id: '$accountId', debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
])


const trialBalance = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const accounts = await FinanceAccount.find({ organizationId }).sort({ code: 1 }).lean()
  const openingEnd = new Date(startDate!.getTime() - 1)
  const [openingRows, periodRows] = await Promise.all([
    aggregateAccountActivity(organizationId, undefined, openingEnd),
    aggregateAccountActivity(organizationId, startDate, endDate),
  ])
  const openingMap = new Map(openingRows.map((r: any) => [String(r._id), r]))
  const periodMap = new Map(periodRows.map((r: any) => [String(r._id), r]))
  const includeZero = query.includeZero === 'true'
  const rows = accounts.map((account: any) => {
    const opening = openingMap.get(String(account._id)) as any
    const period = periodMap.get(String(account._id)) as any
    const openingSigned = Number(opening?.debitMinor || 0) - Number(opening?.creditMinor || 0)
    const periodDebitMinor = Number(period?.debitMinor || 0)
    const periodCreditMinor = Number(period?.creditMinor || 0)
    const closingSigned = openingSigned + periodDebitMinor - periodCreditMinor
    return {
      accountId: String(account._id), code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance,
      openingDebitMinor: Math.max(0, openingSigned), openingCreditMinor: Math.max(0, -openingSigned),
      periodDebitMinor, periodCreditMinor,
      closingDebitMinor: Math.max(0, closingSigned), closingCreditMinor: Math.max(0, -closingSigned),
    }
  }).filter((r) => includeZero || r.openingDebitMinor || r.openingCreditMinor || r.periodDebitMinor || r.periodCreditMinor || r.closingDebitMinor || r.closingCreditMinor)
  const totals = rows.reduce((sum, row) => ({
    openingDebitMinor: sum.openingDebitMinor + row.openingDebitMinor,
    openingCreditMinor: sum.openingCreditMinor + row.openingCreditMinor,
    periodDebitMinor: sum.periodDebitMinor + row.periodDebitMinor,
    periodCreditMinor: sum.periodCreditMinor + row.periodCreditMinor,
    closingDebitMinor: sum.closingDebitMinor + row.closingDebitMinor,
    closingCreditMinor: sum.closingCreditMinor + row.closingCreditMinor,
  }), { openingDebitMinor: 0, openingCreditMinor: 0, periodDebitMinor: 0, periodCreditMinor: 0, closingDebitMinor: 0, closingCreditMinor: 0 })
  return { report: 'trial-balance', currency: settings.baseCurrency, startDate, endDate, rows, totals, balanced: totals.periodDebitMinor === totals.periodCreditMinor && totals.closingDebitMinor === totals.closingCreditMinor }
}

const profitLoss = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const accounts = await FinanceAccount.find({ organizationId, type: { $in: ['REVENUE', 'EXPENSE'] } }).sort({ code: 1 }).lean()
  const activity = await aggregateAccountActivity(organizationId, startDate, endDate)
  const activityMap = new Map(activity.map((r: any) => [String(r._id), r]))
  const rows = accounts.map((account: any) => {
    const a: any = activityMap.get(String(account._id))
    const debitMinor = Number(a?.debitMinor || 0); const creditMinor = Number(a?.creditMinor || 0)
    const amountMinor = account.type === 'REVENUE' ? creditMinor - debitMinor : debitMinor - creditMinor
    const key = String(account.systemKey || '').toUpperCase(); const text = `${key} ${account.name}`.toUpperCase()
    const category = account.type === 'REVENUE' ? 'REVENUE' : text.includes('TAX EXPENSE') || key.includes('TAX_EXPENSE') ? 'TAX' : text.includes('INTEREST') || text.includes('FINANCE COST') || key.includes('INTEREST_EXPENSE') ? 'FINANCE_COST' : 'OPERATING_EXPENSE'
    return { accountId: String(account._id), code: account.code, name: account.name, type: account.type, category, debitMinor, creditMinor, amountMinor }
  }).filter((r) => query.includeZero === 'true' || r.amountMinor !== 0)
  const revenueMinor = rows.filter((r) => r.category === 'REVENUE').reduce((n, r) => n + r.amountMinor, 0)
  const operatingExpenseMinor = rows.filter((r) => r.category === 'OPERATING_EXPENSE').reduce((n, r) => n + r.amountMinor, 0)
  const financeCostMinor = rows.filter((r) => r.category === 'FINANCE_COST').reduce((n, r) => n + r.amountMinor, 0)
  const taxExpenseMinor = rows.filter((r) => r.category === 'TAX').reduce((n, r) => n + r.amountMinor, 0)
  const operatingProfitMinor = revenueMinor - operatingExpenseMinor
  const profitBeforeTaxMinor = operatingProfitMinor - financeCostMinor
  const netProfitMinor = profitBeforeTaxMinor - taxExpenseMinor
  return { report: 'profit-loss', currency: settings.baseCurrency, startDate, endDate, rows, summary: { revenueMinor, operatingExpenseMinor, operatingProfitMinor, financeCostMinor, profitBeforeTaxMinor, taxExpenseMinor, netProfitMinor } }
}

const balanceSheet = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const endDate = inclusiveEnd(query.endDate || query.asOf || new Date())
  const accounts = await FinanceAccount.find({ organizationId }).sort({ code: 1 }).lean()
  const activity = await aggregateAccountActivity(organizationId, undefined, endDate)
  const activityMap = new Map(activity.map((r: any) => [String(r._id), r]))
  const rows = accounts.map((account: any) => {
    const a: any = activityMap.get(String(account._id)); const debitMinor = Number(a?.debitMinor || 0); const creditMinor = Number(a?.creditMinor || 0)
    const amountMinor = accountBalanceForType(account.type, debitMinor, creditMinor)
    return { accountId: String(account._id), code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance, systemKey: account.systemKey || null, debitMinor, creditMinor, amountMinor }
  })
  const assets = rows.filter((r) => r.type === 'ASSET' && (query.includeZero === 'true' || r.amountMinor !== 0))
  const liabilities = rows.filter((r) => r.type === 'LIABILITY' && (query.includeZero === 'true' || r.amountMinor !== 0))
  const equity = rows.filter((r) => r.type === 'EQUITY' && (query.includeZero === 'true' || r.amountMinor !== 0))
  const currentEarningsMinor = rows.filter((r) => r.type === 'REVENUE').reduce((n, r) => n + r.amountMinor, 0) - rows.filter((r) => r.type === 'EXPENSE').reduce((n, r) => n + r.amountMinor, 0)
  const totalAssetsMinor = assets.reduce((n, r) => n + r.amountMinor, 0)
  const totalLiabilitiesMinor = liabilities.reduce((n, r) => n + r.amountMinor, 0)
  const accountEquityMinor = equity.reduce((n, r) => n + r.amountMinor, 0)
  const totalEquityMinor = accountEquityMinor + currentEarningsMinor
  const liabilitiesAndEquityMinor = totalLiabilitiesMinor + totalEquityMinor
  const differenceMinor = totalAssetsMinor - liabilitiesAndEquityMinor
  return { report: 'balance-sheet', currency: settings.baseCurrency, asOf: endDate, assets, liabilities, equity, currentEarningsMinor, summary: { totalAssetsMinor, totalLiabilitiesMinor, accountEquityMinor, currentEarningsMinor, totalEquityMinor, liabilitiesAndEquityMinor, differenceMinor, balanced: differenceMinor === 0 } }
}

const CASH_TYPES = new Set(['CHECKING', 'SAVINGS', 'PETTY_CASH', 'CLIENT_MONEY', 'MOBILE_WALLET'])
const financingSource = (sourceType: string) => /EQUITY|CAPITAL|DIVIDEND|SHAREHOLDER_LOAN|COMPANY_LOAN|LOAN_RECEIPT|LOAN_PAYMENT/.test(sourceType)
const investingSource = (sourceType: string) => /ASSET_PURCHASE|ASSET_SALE|INVESTMENT|PROPERTY_PURCHASE|PROPERTY_SALE|FIXED_ASSET/.test(sourceType)
const cashFlow = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const bankAccounts: any[] = await FinanceBankAccount.find({ organizationId, type: { $in: [...CASH_TYPES] } }).lean()
  const cashAccountIds = bankAccounts.map((b) => b.glAccountId)
  const startMatch = { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES }, accountId: { $in: cashAccountIds }, postingDate: { $lt: startDate! } }
  const openingRows = cashAccountIds.length ? await FinanceJournalLine.aggregate([{ $match: startMatch }, { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } }]) : []
  const periodLines: any[] = cashAccountIds.length ? await FinanceJournalLine.find({ organizationId, journalStatus: { $in: POSTED_LINE_STATUSES }, accountId: { $in: cashAccountIds }, postingDate: { $gte: startDate!, $lte: endDate } }).sort({ postingDate: 1, journalEntryId: 1 }).lean() : []
  const grouped = new Map<string, any>()
  for (const line of periodLines) {
    const key = String(line.journalEntryId); const current = grouped.get(key) || { journalEntryId: key, sourceType: String(line.sourceType || '').toUpperCase(), postingDate: line.postingDate, netCashMinor: 0 }
    current.netCashMinor += Number(line.debitMinor || 0) - Number(line.creditMinor || 0); grouped.set(key, current)
  }
  const internalTransferJournalIds = new Set((await FinanceJournalEntry.find({ organizationId, sourceType: 'BANK_TRANSFER', postingDate: { $gte: startDate!, $lte: endDate }, status: { $in: ['POSTED', 'REVERSED'] } }, { _id: 1 }).lean()).map((r: any) => String(r._id)))
  const details = [...grouped.values()].filter((r) => !internalTransferJournalIds.has(r.journalEntryId) && r.netCashMinor !== 0).map((r) => ({ ...r, category: financingSource(r.sourceType) ? 'FINANCING' : investingSource(r.sourceType) ? 'INVESTING' : 'OPERATING' }))
  const operatingMinor = details.filter((r) => r.category === 'OPERATING').reduce((n, r) => n + r.netCashMinor, 0)
  const investingMinor = details.filter((r) => r.category === 'INVESTING').reduce((n, r) => n + r.netCashMinor, 0)
  const financingMinor = details.filter((r) => r.category === 'FINANCING').reduce((n, r) => n + r.netCashMinor, 0)
  const openingCashMinor = Number(openingRows[0]?.debit || 0) - Number(openingRows[0]?.credit || 0)
  const netChangeMinor = operatingMinor + investingMinor + financingMinor
  return { report: 'cash-flow', currency: settings.baseCurrency, startDate, endDate, sections: { operating: details.filter((r) => r.category === 'OPERATING'), investing: details.filter((r) => r.category === 'INVESTING'), financing: details.filter((r) => r.category === 'FINANCING') }, summary: { openingCashMinor, operatingMinor, investingMinor, financingMinor, netChangeMinor, endingCashMinor: openingCashMinor + netChangeMinor } }
}

const statementOfEquity = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const beforeEnd = new Date(startDate!.getTime() - 1)
  const [openingSheet, closingSheet, pnl, transactions] = await Promise.all([
    balanceSheet(organizationId, { endDate: beforeEnd }), balanceSheet(organizationId, { endDate }), profitLoss(organizationId, { startDate, endDate }),
    FinanceEquityTransaction.find({ organizationId, transactionDate: { $gte: startDate!, $lte: endDate } }).sort({ transactionDate: 1 }).populate('shareholderId', 'name shareClass').lean(),
  ])
  const contributionTypes = new Set(['CAPITAL_CONTRIBUTION', 'SHARE_ISSUE'])
  const distributionTypes = new Set(['SHARE_BUYBACK', 'CAPITAL_RETURN', 'OWNER_DRAW', 'DIVIDEND_DECLARATION'])
  const contributionsMinor = transactions.filter((t: any) => contributionTypes.has(t.type)).reduce((n: number, t: any) => n + Number(t.amountMinor || 0), 0)
  const distributionsMinor = transactions.filter((t: any) => distributionTypes.has(t.type)).reduce((n: number, t: any) => n + Number(t.amountMinor || 0), 0)
  const openingEquityMinor = openingSheet.summary.totalEquityMinor
  const netProfitMinor = pnl.summary.netProfitMinor
  const closingEquityMinor = closingSheet.summary.totalEquityMinor
  const otherAdjustmentsMinor = closingEquityMinor - openingEquityMinor - contributionsMinor + distributionsMinor - netProfitMinor
  const shareholderMap = new Map<string, any>()
  for (const tx of transactions as any[]) {
    const sh: any = tx.shareholderId; if (!sh?._id) continue
    const key = String(sh._id); const row = shareholderMap.get(key) || { shareholderId: key, name: sh.name, shareClass: sh.shareClass, contributionsMinor: 0, distributionsMinor: 0 }
    if (contributionTypes.has(tx.type)) row.contributionsMinor += Number(tx.amountMinor || 0)
    if (distributionTypes.has(tx.type)) row.distributionsMinor += Number(tx.amountMinor || 0)
    shareholderMap.set(key, row)
  }
  return { report: 'statement-of-equity', currency: settings.baseCurrency, startDate, endDate, summary: { openingEquityMinor, contributionsMinor, netProfitMinor, distributionsMinor, otherAdjustmentsMinor, closingEquityMinor }, shareholderActivity: [...shareholderMap.values()], transactions }
}

const propertyProfitability = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const match: any = { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES }, postingDate: { $gte: startDate!, $lte: endDate }, propertyId: { $ne: null } }
  if (query.propertyId) match.propertyId = objectId(query.propertyId, 'property id')
  const rows: any[] = await FinanceJournalLine.aggregate([
    { $match: match },
    { $lookup: { from: 'financeaccounts', localField: 'accountId', foreignField: '_id', as: 'account' } }, { $unwind: '$account' },
    { $match: { 'account.type': { $in: ['REVENUE', 'EXPENSE'] } } },
    { $group: { _id: { propertyId: '$propertyId', accountId: '$accountId', type: '$account.type', code: '$account.code', name: '$account.name' }, debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
  ])
  const propertyIds = [...new Set(rows.map((r) => String(r._id.propertyId)))].map((id) => objectId(id, 'property id'))
  const properties: any[] = propertyIds.length ? await Property.find({ organizationId, _id: { $in: propertyIds } }, { title: 1, address: 1, propertyType: 1 }).lean() : []
  const propMap = new Map(properties.map((p: any) => [String(p._id), p]))
  const grouped = new Map<string, any>()
  for (const r of rows) {
    const propertyId = String(r._id.propertyId); const p = propMap.get(propertyId) as any
    const current = grouped.get(propertyId) || { propertyId, title: p?.title || 'Property', address: p?.address || null, revenueMinor: 0, expenseMinor: 0, netProfitMinor: 0, accounts: [] }
    const amountMinor = r._id.type === 'REVENUE' ? Number(r.creditMinor || 0) - Number(r.debitMinor || 0) : Number(r.debitMinor || 0) - Number(r.creditMinor || 0)
    if (r._id.type === 'REVENUE') current.revenueMinor += amountMinor; else current.expenseMinor += amountMinor
    current.accounts.push({ accountId: String(r._id.accountId), code: r._id.code, name: r._id.name, type: r._id.type, amountMinor })
    current.netProfitMinor = current.revenueMinor - current.expenseMinor; grouped.set(propertyId, current)
  }
  const data = [...grouped.values()].sort((a, b) => b.netProfitMinor - a.netProfitMinor)
  const totals = data.reduce((s, r) => ({ revenueMinor: s.revenueMinor + r.revenueMinor, expenseMinor: s.expenseMinor + r.expenseMinor, netProfitMinor: s.netProfitMinor + r.netProfitMinor }), { revenueMinor: 0, expenseMinor: 0, netProfitMinor: 0 })
  return { report: 'property-profitability', currency: settings.baseCurrency, startDate, endDate, data, totals }
}

const taxReport = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const codes: any[] = await FinanceTaxCode.find({ organizationId }).sort({ code: 1 }).lean()
  const invoiceAgg: any[] = await FinanceInvoice.aggregate([
    { $match: { organizationId, archivedAt: null, taxCodeId: { $ne: null }, revenueJournalId: { $ne: null }, issueDate: { $gte: startDate!, $lte: endDate }, status: { $nin: ['draft', 'cancelled'] } } },
    { $group: { _id: '$taxCodeId', taxAmount: { $sum: '$taxAmount' }, taxableAmount: { $sum: { $subtract: ['$total', '$taxAmount'] } }, documents: { $sum: 1 } } },
  ])
  const billAgg: any[] = await FinanceVendorBill.aggregate([
    { $match: { organizationId, taxCodeId: { $ne: null }, postingJournalId: { $ne: null }, billDate: { $gte: startDate!, $lte: endDate }, status: { $in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } },
    { $group: { _id: '$taxCodeId', taxAmountMinor: { $sum: '$taxAmountMinor' }, taxableAmountMinor: { $sum: '$subtotalMinor' }, documents: { $sum: 1 } } },
  ])
  const invMap = new Map(invoiceAgg.map((r) => [String(r._id), r])); const billMap = new Map(billAgg.map((r) => [String(r._id), r]))
  const rows = codes.map((code: any) => {
    const inv: any = invMap.get(String(code._id)); const bill: any = billMap.get(String(code._id))
    const outputTaxMinor = inv ? moneyToMinorUnits(Number(inv.taxAmount || 0), 'invoice tax') : 0
    const outputTaxableMinor = inv ? moneyToMinorUnits(Number(inv.taxableAmount || 0), 'invoice taxable amount') : 0
    const inputTaxMinor = Number(bill?.taxAmountMinor || 0); const inputTaxableMinor = Number(bill?.taxableAmountMinor || 0)
    return { taxCodeId: String(code._id), code: code.code, name: code.name, type: code.type, direction: code.direction, rateBasisPoints: code.rateBasisPoints, outputTaxMinor, inputTaxMinor, withholdingMinor: code.direction === 'WITHHOLDING' ? Math.max(outputTaxMinor, inputTaxMinor) : 0, outputTaxableMinor, inputTaxableMinor, documents: Number(inv?.documents || 0) + Number(bill?.documents || 0) }
  })
  const outputTaxMinor = rows.reduce((n, r) => n + r.outputTaxMinor, 0); const inputTaxMinor = rows.reduce((n, r) => n + r.inputTaxMinor, 0); const withholdingMinor = rows.reduce((n, r) => n + r.withholdingMinor, 0)
  return { report: 'tax', currency: settings.baseCurrency, startDate, endDate, rows, summary: { outputTaxMinor, inputTaxMinor, withholdingMinor, netTaxPayableMinor: outputTaxMinor - inputTaxMinor } }
}

const budgetVsActual = async (organizationId: string, query: Record<string, unknown> = {}) => {
  const settings = await ensureInitialized(organizationId)
  const { startDate, endDate } = normalizeRange(query, true)
  const budgets: any[] = await FinanceBudget.find({ organizationId, status: 'active', startDate: { $lte: endDate }, endDate: { $gte: startDate! } }).lean()
  const mappings: any[] = await FinanceCategoryAccountMapping.find({ organizationId, transactionType: 'expense' }).lean()
  const mappingMap = new Map(mappings.map((m: any) => [String(m.categoryKey), String(m.accountId)]))
  const normalizeCategory = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
  const rows = await Promise.all(budgets.map(async (b) => {
    const accountId = mappingMap.get(normalizeCategory(b.category)) || null
    const budgetMinor = moneyToMinorUnits(Number(b.amount || 0), 'budget amount')
    const effectiveStart = new Date(Math.max(startDate!.getTime(), new Date(b.startDate).getTime()))
    const effectiveEnd = new Date(Math.min(endDate.getTime(), new Date(b.endDate).getTime()))
    let actualMinor = 0
    if (accountId && effectiveStart <= effectiveEnd) {
      const totals: any[] = await FinanceJournalLine.aggregate([
        { $match: { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES }, accountId: objectId(accountId, 'budget account id'), postingDate: { $gte: effectiveStart, $lte: effectiveEnd } } },
        { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } },
      ])
      actualMinor = Number(totals[0]?.debit || 0) - Number(totals[0]?.credit || 0)
    }
    const varianceMinor = budgetMinor - actualMinor; const variancePercent = budgetMinor ? (varianceMinor / budgetMinor) * 100 : 0
    return { budgetId: String(b._id), name: b.name, category: b.category, accountId, startDate: b.startDate, endDate: b.endDate, budgetMinor, actualMinor, varianceMinor, variancePercent, status: actualMinor > budgetMinor ? 'OVER' : 'WITHIN' }
  }))
  const totals = rows.reduce((s, r) => ({ budgetMinor: s.budgetMinor + r.budgetMinor, actualMinor: s.actualMinor + r.actualMinor, varianceMinor: s.varianceMinor + r.varianceMinor }), { budgetMinor: 0, actualMinor: 0, varianceMinor: 0 })
  return { report: 'budget-vs-actual', currency: settings.baseCurrency, startDate, endDate, rows, totals }
}

const generalLedgerReport = async (organizationId: string, query: Record<string, unknown> = {}) => {
  await ensureInitialized(organizationId)
  const result = await FinanceAccountingService.getGeneralLedger(organizationId, { ...query, limit: Math.min(500, Number(query.limit || 100)) })
  const journalIds = [...new Set(result.data.map((r: any) => String(r.journalEntryId)))].map((id) => objectId(id, 'journal id'))
  const journals: any[] = journalIds.length ? await FinanceJournalEntry.find({ organizationId, _id: { $in: journalIds } }, { journalNumber: 1, sourceType: 1, sourceId: 1, description: 1, reference: 1, status: 1 }).lean() : []
  const jMap = new Map(journals.map((j: any) => [String(j._id), j]))
  return { report: 'general-ledger', ...result, data: result.data.map((line: any) => ({ ...line, journal: jMap.get(String(line.journalEntryId)) || null, drilldown: { journalEntryId: String(line.journalEntryId), sourceType: line.sourceType, sourceId: jMap.get(String(line.journalEntryId))?.sourceId || null } })) }
}

const agingReport = async (organizationId: string, query: Record<string, unknown>, kind: 'ar' | 'ap') => {
  await ensureInitialized(organizationId)
  const result = kind === 'ar' ? await FinanceOperationsService.receivables(organizationId, { ...query, includeSettled: query.includeSettled || 'false' }) : await FinanceOperationsService.payables(organizationId, { ...query, includeSettled: query.includeSettled || 'false' })
  const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean()
  return { report: kind === 'ar' ? 'ar-aging' : 'ap-aging', currency: settings?.baseCurrency || 'BDT', ...result }
}

const drilldown = async (organizationId: string, query: Record<string, unknown> = {}) => {
  await ensureInitialized(organizationId)
  const filter: any = { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES } }
  if (query.accountId) { const account = await FinanceAccount.findOne({ _id: objectId(query.accountId, 'account id'), organizationId }).lean(); if (!account) throw new ApiError(httpStatus.NOT_FOUND, 'Finance account not found'); filter.accountId = account._id }
  if (query.journalEntryId) filter.journalEntryId = objectId(query.journalEntryId, 'journal id')
  if (query.propertyId) filter.propertyId = objectId(query.propertyId, 'property id')
  if (query.startDate || query.endDate) filter.postingDate = { ...(query.startDate ? { $gte: startOfDay(query.startDate) } : {}), ...(query.endDate ? { $lte: inclusiveEnd(query.endDate) } : {}) }
  const page = Math.max(1, Number(query.page || 1)); const limit = Math.min(200, Math.max(1, Number(query.limit || 50))); const skip = (page - 1) * limit
  const [data, total] = await Promise.all([
    FinanceJournalLine.find(filter).sort({ postingDate: -1, createdAt: -1, lineNumber: 1 }).skip(skip).limit(limit).populate('accountId', 'code name type normalBalance').lean(),
    FinanceJournalLine.countDocuments(filter),
  ])
  const journalIds = [...new Set(data.map((r: any) => String(r.journalEntryId)))].map((id) => objectId(id, 'journal id'))
  const journals: any[] = journalIds.length ? await FinanceJournalEntry.find({ organizationId, _id: { $in: journalIds } }).lean() : []
  const jMap = new Map(journals.map((j: any) => [String(j._id), j]))
  const sourceHref = (j: any) => {
    const rawId = String(j?.sourceId || '').trim(); const sourceType = String(j?.sourceType || '').toUpperCase()
    if (!rawId) return null
    const entityId = rawId.split(':v')[0]
    if (sourceType === 'INVOICE_REVENUE') return `/dashboard/admin/finance/billing?invoice=${entityId}`
    if (sourceType === 'INVOICE_PAYMENT') return '/dashboard/admin/finance/billing'
    if (sourceType === 'CLIENT_DEPOSIT_APPLICATION' || sourceType.startsWith('CLIENT_DEPOSIT_')) return '/dashboard/admin/finance/operations'
    if (sourceType === 'VENDOR_BILL') return `/dashboard/admin/finance/operations?bill=${entityId}`
    if (sourceType.startsWith('VENDOR_BILL')) return '/dashboard/admin/finance/operations'
    if (sourceType.includes('COMMISSION')) return '/dashboard/admin/finance'
    if (sourceType.includes('DIVIDEND') || sourceType.includes('EQUITY') || sourceType.includes('CAPITAL') || sourceType.includes('LOAN')) return '/dashboard/admin/finance/capital'
    return null
  }
  return { data: data.map((line: any) => { const journal: any = jMap.get(String(line.journalEntryId)); return { ...line, journal: journal ? { _id: journal._id, journalNumber: journal.journalNumber, description: journal.description, reference: journal.reference, sourceType: journal.sourceType, sourceId: journal.sourceId, status: journal.status } : null, sourceHref: sourceHref(journal) } }), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }
}

const getReport = async (organizationId: string, report: FinanceReportKey, query: Record<string, unknown> = {}) => {
  switch (report) {
    case 'trial-balance': return trialBalance(organizationId, query)
    case 'balance-sheet': return balanceSheet(organizationId, query)
    case 'profit-loss': return profitLoss(organizationId, query)
    case 'cash-flow': return cashFlow(organizationId, query)
    case 'statement-of-equity': return statementOfEquity(organizationId, query)
    case 'general-ledger': return generalLedgerReport(organizationId, query)
    case 'ar-aging': return agingReport(organizationId, query, 'ar')
    case 'ap-aging': return agingReport(organizationId, query, 'ap')
    case 'property-profitability': return propertyProfitability(organizationId, query)
    case 'tax': return taxReport(organizationId, query)
    case 'budget-vs-actual': return budgetVsActual(organizationId, query)
    default: throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported finance report')
  }
}

const completeGeneralLedgerForExport = async (organizationId: string, query: Record<string, unknown> = {}) => {
  // Reuse the canonical ledger service first so tenant/dimension filters are validated consistently.
  const validated = await generalLedgerReport(organizationId, { ...query, page: 1, limit: 1 })
  const total = Number(validated.meta?.total || 0)
  if (total > 100000) throw new ApiError(httpStatus.BAD_REQUEST, 'General Ledger export exceeds 100,000 rows. Narrow the report date range or filters and try again.')
  if (!total) return { ...validated, data: [], meta: { ...validated.meta, page: 1, limit: 0, total: 0, totalPages: 1 } }

  const filter: Record<string, any> = { organizationId, journalStatus: { $in: POSTED_LINE_STATUSES } }
  if (query.accountId) filter.accountId = objectId(query.accountId, 'account id')
  if (query.propertyId) filter.propertyId = objectId(query.propertyId, 'property id')
  if (query.agentId) filter.agentId = objectId(query.agentId, 'agent id')
  if (query.vendorId) filter.vendorId = objectId(query.vendorId, 'vendor id')
  if (query.clientId) filter.clientId = objectId(query.clientId, 'client id')
  if (query.shareholderId) filter.shareholderId = objectId(query.shareholderId, 'shareholder id')
  if (query.sourceType) filter.sourceType = String(query.sourceType).trim().toUpperCase()
  if (query.startDate || query.endDate) filter.postingDate = { ...(query.startDate ? { $gte: startOfDay(query.startDate) } : {}), ...(query.endDate ? { $lte: inclusiveEnd(query.endDate) } : {}) }

  const lines: any[] = await FinanceJournalLine.find(filter)
    .sort({ postingDate: 1, createdAt: 1, lineNumber: 1, _id: 1 })
    .limit(total)
    .populate('accountId', 'code name type normalBalance')
    .lean()
  const journalIds = [...new Set(lines.map((line: any) => String(line.journalEntryId)))].map((id) => objectId(id, 'journal id'))
  const journals: any[] = journalIds.length ? await FinanceJournalEntry.find({ organizationId, _id: { $in: journalIds } }, { journalNumber: 1, sourceType: 1, sourceId: 1, description: 1, reference: 1, status: 1 }).lean() : []
  const journalMap = new Map(journals.map((journal: any) => [String(journal._id), journal]))
  return { ...validated, data: lines.map((line: any) => ({ ...line, journal: journalMap.get(String(line.journalEntryId)) || null })), meta: { ...validated.meta, page: 1, limit: lines.length, total, totalPages: 1 } }
}

const flattenReport = (report: FinanceReportKey, data: any): { title: string; columns: Array<{ key: string; label: string }>; rows: Record<string, any>[] } => {
  if (report === 'trial-balance') {
    const columns = [{ key: 'code', label: 'Account' }, { key: 'name', label: 'Name' }, { key: 'openingDebit', label: 'Opening Debit' }, { key: 'openingCredit', label: 'Opening Credit' }, { key: 'periodDebit', label: 'Period Debit' }, { key: 'periodCredit', label: 'Period Credit' }, { key: 'closingDebit', label: 'Closing Debit' }, { key: 'closingCredit', label: 'Closing Credit' }]
    const rows = data.rows.map((r: any) => ({ code: r.code, name: r.name, openingDebit: money(r.openingDebitMinor, data.currency), openingCredit: money(r.openingCreditMinor, data.currency), periodDebit: money(r.periodDebitMinor, data.currency), periodCredit: money(r.periodCreditMinor, data.currency), closingDebit: money(r.closingDebitMinor, data.currency), closingCredit: money(r.closingCreditMinor, data.currency) }))
    rows.push({ code: '', name: data.balanced ? 'TOTAL — BALANCED' : 'TOTAL — OUT OF BALANCE', openingDebit: money(data.totals.openingDebitMinor, data.currency), openingCredit: money(data.totals.openingCreditMinor, data.currency), periodDebit: money(data.totals.periodDebitMinor, data.currency), periodCredit: money(data.totals.periodCreditMinor, data.currency), closingDebit: money(data.totals.closingDebitMinor, data.currency), closingCredit: money(data.totals.closingCreditMinor, data.currency) })
    return { title: 'Trial Balance', columns, rows }
  }
  if (report === 'balance-sheet') {
    const columns = [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Account' }, { key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }]
    const rows = [
      ...data.assets.map((r: any) => ({ section: 'Assets', code: r.code, name: r.name, amount: money(r.amountMinor, data.currency) })),
      { section: 'Assets', code: '', name: 'TOTAL ASSETS', amount: money(data.summary.totalAssetsMinor, data.currency) },
      ...data.liabilities.map((r: any) => ({ section: 'Liabilities', code: r.code, name: r.name, amount: money(r.amountMinor, data.currency) })),
      { section: 'Liabilities', code: '', name: 'TOTAL LIABILITIES', amount: money(data.summary.totalLiabilitiesMinor, data.currency) },
      ...data.equity.map((r: any) => ({ section: 'Equity', code: r.code, name: r.name, amount: money(r.amountMinor, data.currency) })),
      { section: 'Equity', code: '', name: 'Current Year / Unclosed Earnings', amount: money(data.currentEarningsMinor, data.currency) },
      { section: 'Equity', code: '', name: 'TOTAL EQUITY', amount: money(data.summary.totalEquityMinor, data.currency) },
      { section: 'Check', code: '', name: 'TOTAL LIABILITIES + EQUITY', amount: money(data.summary.liabilitiesAndEquityMinor, data.currency) },
      { section: 'Check', code: '', name: data.summary.balanced ? 'ACCOUNTING EQUATION — BALANCED' : 'ACCOUNTING EQUATION DIFFERENCE', amount: money(data.summary.differenceMinor, data.currency) },
    ]
    return { title: 'Balance Sheet', columns, rows }
  }
  if (report === 'profit-loss') {
    const columns = [{ key: 'category', label: 'Category' }, { key: 'code', label: 'Account' }, { key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }]
    const rows = data.rows.map((r: any) => ({ category: r.category, code: r.code, name: r.name, amount: money(r.amountMinor, data.currency) }))
    rows.push(
      { category: 'SUMMARY', code: '', name: 'TOTAL REVENUE', amount: money(data.summary.revenueMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'OPERATING EXPENSES', amount: money(data.summary.operatingExpenseMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'OPERATING PROFIT', amount: money(data.summary.operatingProfitMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'FINANCE COSTS', amount: money(data.summary.financeCostMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'PROFIT BEFORE TAX', amount: money(data.summary.profitBeforeTaxMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'TAX', amount: money(data.summary.taxExpenseMinor, data.currency) },
      { category: 'SUMMARY', code: '', name: 'NET PROFIT', amount: money(data.summary.netProfitMinor, data.currency) },
    )
    return { title: 'Profit & Loss', columns, rows }
  }
  if (report === 'cash-flow') {
    const columns = [{ key: 'category', label: 'Category' }, { key: 'date', label: 'Date' }, { key: 'source', label: 'Source' }, { key: 'amount', label: 'Cash Movement' }]
    const rows = [
      ...data.sections.operating.map((r: any) => ({ category: 'Operating', date: new Date(r.postingDate).toISOString().slice(0, 10), source: r.sourceType, amount: money(r.netCashMinor, data.currency) })),
      ...data.sections.investing.map((r: any) => ({ category: 'Investing', date: new Date(r.postingDate).toISOString().slice(0, 10), source: r.sourceType, amount: money(r.netCashMinor, data.currency) })),
      ...data.sections.financing.map((r: any) => ({ category: 'Financing', date: new Date(r.postingDate).toISOString().slice(0, 10), source: r.sourceType, amount: money(r.netCashMinor, data.currency) })),
      { category: 'Summary', date: '', source: 'Opening cash', amount: money(data.summary.openingCashMinor, data.currency) },
      { category: 'Summary', date: '', source: 'Operating activities', amount: money(data.summary.operatingMinor, data.currency) },
      { category: 'Summary', date: '', source: 'Investing activities', amount: money(data.summary.investingMinor, data.currency) },
      { category: 'Summary', date: '', source: 'Financing activities', amount: money(data.summary.financingMinor, data.currency) },
      { category: 'Summary', date: '', source: 'Net change in cash', amount: money(data.summary.netChangeMinor, data.currency) },
      { category: 'Summary', date: '', source: 'Ending cash', amount: money(data.summary.endingCashMinor, data.currency) },
    ]
    return { title: 'Cash Flow Statement', columns, rows }
  }
  if (report === 'statement-of-equity') return { title: 'Statement of Equity', columns: [{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount' }], rows: [{ item: 'Opening Equity', amount: money(data.summary.openingEquityMinor, data.currency) }, { item: 'Capital Contributions', amount: money(data.summary.contributionsMinor, data.currency) }, { item: 'Net Profit', amount: money(data.summary.netProfitMinor, data.currency) }, { item: 'Dividends / Capital Returns', amount: money(-data.summary.distributionsMinor, data.currency) }, { item: 'Other Adjustments', amount: money(data.summary.otherAdjustmentsMinor, data.currency) }, { item: 'Closing Equity', amount: money(data.summary.closingEquityMinor, data.currency) }] }
  if (report === 'general-ledger') {
    const columns = [{ key: 'date', label: 'Date' }, { key: 'journal', label: 'Journal' }, { key: 'account', label: 'Account' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }]
    const rows = data.data.map((r: any) => ({ date: new Date(r.postingDate).toISOString().slice(0, 10), journal: r.journal?.journalNumber || r.journalNumber || '', account: `${r.accountId?.code || ''} ${r.accountId?.name || ''}`.trim(), description: r.description || r.journal?.description || '', debit: money(r.debitMinor, r.currency), credit: money(r.creditMinor, r.currency) }))
    rows.push({ date: '', journal: '', account: '', description: 'TOTAL', debit: money(data.summary?.debitMinor || 0, data.data[0]?.currency || 'BDT'), credit: money(data.summary?.creditMinor || 0, data.data[0]?.currency || 'BDT') })
    return { title: 'General Ledger', columns, rows }
  }
  if (report === 'ar-aging' || report === 'ap-aging') {
    const isAr = report === 'ar-aging'
    const columns = [{ key: 'document', label: isAr ? 'Invoice' : 'Bill' }, { key: 'party', label: isAr ? 'Customer' : 'Vendor' }, { key: 'due', label: 'Due Date' }, { key: 'days', label: 'Days Overdue' }, { key: 'outstanding', label: 'Outstanding' }]
    const rows = data.data.map((r: any) => ({ document: isAr ? r.invoiceNumber : r.billNumber, party: isAr ? (r.customer?.name || '') : (r.vendor?.name || r.vendorId?.name || r.vendorId || ''), due: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : '', days: r.daysOverdue, outstanding: money(r.outstandingMinor, data.currency) }))
    rows.push({ document: '', party: '', due: '', days: '', outstanding: money(data.aging?.total || 0, data.currency) })
    return { title: isAr ? 'Accounts Receivable Aging' : 'Accounts Payable Aging', columns, rows }
  }
  if (report === 'property-profitability') {
    const columns = [{ key: 'property', label: 'Property' }, { key: 'revenue', label: 'Revenue' }, { key: 'expense', label: 'Expenses' }, { key: 'profit', label: 'Net Profit' }]
    const rows = data.data.map((r: any) => ({ property: r.title, revenue: money(r.revenueMinor, data.currency), expense: money(r.expenseMinor, data.currency), profit: money(r.netProfitMinor, data.currency) }))
    rows.push({ property: 'TOTAL', revenue: money(data.totals.revenueMinor, data.currency), expense: money(data.totals.expenseMinor, data.currency), profit: money(data.totals.netProfitMinor, data.currency) })
    return { title: 'Property Profitability', columns, rows }
  }
  if (report === 'tax') {
    const columns = [{ key: 'code', label: 'Tax Code' }, { key: 'name', label: 'Name' }, { key: 'output', label: 'Output Tax' }, { key: 'input', label: 'Input Tax' }, { key: 'withholding', label: 'Withholding' }, { key: 'documents', label: 'Documents' }]
    const rows = data.rows.map((r: any) => ({ code: r.code, name: r.name, output: money(r.outputTaxMinor, data.currency), input: money(r.inputTaxMinor, data.currency), withholding: money(r.withholdingMinor, data.currency), documents: r.documents }))
    rows.push({ code: '', name: 'TOTAL', output: money(data.summary.outputTaxMinor, data.currency), input: money(data.summary.inputTaxMinor, data.currency), withholding: money(data.summary.withholdingMinor, data.currency), documents: data.rows.reduce((n: number, r: any) => n + Number(r.documents || 0), 0) })
    return { title: 'Tax / VAT Report', columns, rows }
  }
  const columns = [{ key: 'budget', label: 'Budget' }, { key: 'category', label: 'Category' }, { key: 'planned', label: 'Budget' }, { key: 'actual', label: 'Actual' }, { key: 'variance', label: 'Variance' }]
  const rows = data.rows.map((r: any) => ({ budget: r.name, category: r.category, planned: money(r.budgetMinor, data.currency), actual: money(r.actualMinor, data.currency), variance: money(r.varianceMinor, data.currency) }))
  rows.push({ budget: 'TOTAL', category: '', planned: money(data.totals.budgetMinor, data.currency), actual: money(data.totals.actualMinor, data.currency), variance: money(data.totals.varianceMinor, data.currency) })
  return { title: 'Budget vs Actual', columns, rows }
}

const csvEscape = (value: unknown) => { let s = String(value ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const exportCsv = (flat: ReturnType<typeof flattenReport>) => Buffer.from([flat.columns.map((c) => csvEscape(c.label)).join(','), ...flat.rows.map((r) => flat.columns.map((c) => csvEscape(r[c.key])).join(','))].join('\n'), 'utf8')
const exportXlsx = async (flat: ReturnType<typeof flattenReport>) => { const wb = new ExcelJS.Workbook(); wb.creator = 'Opygen Estate'; const ws = wb.addWorksheet(flat.title.slice(0, 31)); ws.columns = flat.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, Math.min(42, c.label.length + 8)) })); ws.addRows(flat.rows); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: flat.columns.length } }; return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer) }
const pdfSafe = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?')
const exportPdf = async (organizationId: string, flat: ReturnType<typeof flattenReport>, data: any) => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const org: any = await Organization.findOne({ organizationId }, { agencyName: 1 }).lean();
  const landscape = flat.columns.length > 5; const pageWidth = landscape ? 841.89 : 595.28; const pageHeight = landscape ? 595.28 : 841.89; const margin = 38; const rowHeight = 18; let page = pdf.addPage([pageWidth, pageHeight]); let y = pageHeight - 45
  const drawHeader = () => { page.drawText(pdfSafe(org?.agencyName || 'Opygen Estate'), { x: margin, y, size: 13, font: bold, color: rgb(0.1,0.1,0.1) }); y -= 20; page.drawText(pdfSafe(flat.title), { x: margin, y, size: 18, font: bold }); y -= 18; const period = data.asOf ? `As of ${new Date(data.asOf).toISOString().slice(0,10)}` : data.startDate && data.endDate ? `${new Date(data.startDate).toISOString().slice(0,10)} to ${new Date(data.endDate).toISOString().slice(0,10)}` : ''; if (period) { page.drawText(pdfSafe(period), { x: margin, y, size: 9, font }); y -= 20 } }
  drawHeader(); const available = pageWidth - margin * 2; const colWidth = available / Math.max(1, flat.columns.length)
  const drawColumns = () => { flat.columns.forEach((c, i) => page.drawText(pdfSafe(c.label).slice(0, 22), { x: margin + i * colWidth, y, size: 7.5, font: bold })); y -= rowHeight }
  drawColumns()
  for (const row of flat.rows) { if (y < 50) { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - 45; drawHeader(); drawColumns() } flat.columns.forEach((c, i) => page.drawText(pdfSafe(row[c.key]).slice(0, 28), { x: margin + i * colWidth, y, size: 7, font })); y -= rowHeight }
  return Buffer.from(await pdf.save())
}

const exportReport = async (organizationId: string, report: FinanceReportKey, format: FinanceReportExportFormat, query: Record<string, unknown> = {}): Promise<FinanceReportExport> => {
  const data = report === 'general-ledger' ? await completeGeneralLedgerForExport(organizationId, query) : await getReport(organizationId, report, query); const flat = flattenReport(report, data); const stamp = new Date().toISOString().slice(0, 10); const base = `${report}-${stamp}`
  if (format === 'csv') return { buffer: exportCsv(flat), contentType: 'text/csv; charset=utf-8', fileName: `${base}.csv` }
  if (format === 'xlsx') return { buffer: await exportXlsx(flat), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${base}.xlsx` }
  return { buffer: await exportPdf(organizationId, flat, data), contentType: 'application/pdf', fileName: `${base}.pdf` }
}

export const FinanceReportingService = {
  getReport, trialBalance, balanceSheet, profitLoss, cashFlow, statementOfEquity, generalLedgerReport,
  propertyProfitability, taxReport, budgetVsActual, drilldown, exportReport,
}
