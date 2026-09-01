import mongoose from 'mongoose'
import config from '../../config'
import { Organization } from '../module/organization/organization.model'
import { FinanceTransaction, FinanceInvoice, FinanceCommission } from '../module/finance/finance.model'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import { FinanceAccount, FinanceJournalEntry, FinanceJournalLine } from '../module/finance/financeAccounting.model'
import { FinanceBankAccount, FinanceVendorBill, FinanceBankTransfer, FinanceClientDeposit, FinanceReconciliation } from '../module/finance/financeOperations.model'
import { FinanceEquityTransaction, FinanceShareholderLoan, FinanceDividend, FinanceLoan } from '../module/finance/financeCapital.model'
import { FinanceAccountingInitialization } from '../module/finance/financeInitialization.model'
import { LEGACY_FINANCE_CURRENCY } from '../module/finance/finance.contract'
import { moneyToMinorUnits } from '../module/finance/finance.money'

type Severity = 'critical' | 'warning' | 'info'
type Finding = { code: string; severity: Severity; message: string; count?: number; details?: Record<string, unknown> }
type ExpectedPosting = { sourceType: string; sourceId: string; entity: string; entityId: string }

const scopedOrganization = process.argv.find((arg: string) => arg.startsWith('--organization='))?.split('=', 2)[1]?.trim()
const failOnFindings = process.argv.includes('--fail-on-findings')
const oid = (value: unknown) => value ? String(value) : ''

const connect = () => mongoose.connect(config.database_string as string, {
  autoIndex: false,
  serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  connectTimeoutMS: config.mongo.connect_timeout_ms,
})

const expectedPostings = async (organizationId: string): Promise<ExpectedPosting[]> => {
  const [transactions, invoices, commissions, bills, transfers, deposits, equities, shareholderLoans, dividends, loans] = await Promise.all([
    FinanceTransaction.find({ organizationId, deletedAt: null }).select('_id sourceType accountingVersion accountingJournalId').lean(),
    FinanceInvoice.find({ organizationId, archivedAt: null }).select('_id accountingVersion revenueJournalId payments status').lean(),
    FinanceCommission.find({ organizationId, archivedAt: null }).select('_id accountingVersion accrualJournalId payoutTransactionId payoutJournalId').lean(),
    FinanceVendorBill.find({ organizationId }).select('_id accountingVersion postingJournalId payments').lean(),
    FinanceBankTransfer.find({ organizationId }).select('_id transferNumber journalEntryId').lean(),
    FinanceClientDeposit.find({ organizationId }).select('_id depositNumber receiptJournalId applications refunds').lean(),
    FinanceEquityTransaction.find({ organizationId }).select('_id type transactionNumber journalEntryId').lean(),
    FinanceShareholderLoan.find({ organizationId }).select('_id loanNumber receiptJournalId payments').lean(),
    FinanceDividend.find({ organizationId }).select('_id dividendNumber declarationJournalId payments').lean(),
    FinanceLoan.find({ organizationId }).select('_id loanNumber receiptJournalId payments').lean(),
  ])
  const rows: ExpectedPosting[] = []
  const add = (sourceType: string, sourceId: unknown, entity: string, entityId: unknown) => {
    const id = oid(sourceId)
    if (id) rows.push({ sourceType, sourceId: id, entity, entityId: oid(entityId) })
  }

  for (const tx of transactions as Array<Record<string, unknown>>) {
    const version = Number(tx.accountingVersion || 0)
    if (version <= 0 || !tx.accountingJournalId) continue
    const sourceType = String(tx.sourceType || '')
    if (sourceType === 'manual') add('MANUAL_TRANSACTION', `${oid(tx._id)}:v${version}`, 'transaction', tx._id)
    if (sourceType === 'invoice_payment') add('INVOICE_PAYMENT', tx._id, 'invoice-payment', tx._id)
    if (sourceType === 'commission_payout') add('COMMISSION_PAYOUT', tx._id, 'commission-payout', tx._id)
  }
  for (const invoice of invoices as Array<Record<string, unknown>>) {
    const version = Number(invoice.accountingVersion || 0)
    if (version > 0 && invoice.revenueJournalId) add('INVOICE_REVENUE', `${oid(invoice._id)}:v${version}`, 'invoice', invoice._id)
  }
  for (const commission of commissions as Array<Record<string, unknown>>) {
    const version = Number(commission.accountingVersion || 0)
    if (version > 0 && commission.accrualJournalId) add('COMMISSION_ACCRUAL', `${oid(commission._id)}:v${version}`, 'commission', commission._id)
    if (commission.payoutTransactionId && commission.payoutJournalId) add('COMMISSION_PAYOUT', commission.payoutTransactionId, 'commission-payout', commission._id)
  }
  for (const bill of bills as Array<Record<string, unknown>>) {
    const version = Number(bill.accountingVersion || 0)
    if (version > 0 && bill.postingJournalId) add('VENDOR_BILL', `${oid(bill._id)}:v${version}`, 'vendor-bill', bill._id)
    for (const payment of (bill.payments || []) as Array<Record<string, unknown>>) if (payment.journalEntryId) add('VENDOR_BILL_PAYMENT', payment._id, 'vendor-bill-payment', bill._id)
  }
  for (const row of transfers as Array<Record<string, unknown>>) if (row.journalEntryId) add('BANK_TRANSFER', row.transferNumber, 'bank-transfer', row._id)
  for (const row of deposits as Array<Record<string, unknown>>) {
    if (row.receiptJournalId) add('CLIENT_DEPOSIT_RECEIPT', row.depositNumber, 'client-deposit', row._id)
    for (const application of (row.applications || []) as Array<Record<string, unknown>>) if (application.journalEntryId) add('CLIENT_DEPOSIT_APPLICATION', application._id, 'deposit-application', row._id)
    for (const refund of (row.refunds || []) as Array<Record<string, unknown>>) if (refund.journalEntryId) add('CLIENT_DEPOSIT_REFUND', refund._id, 'deposit-refund', row._id)
  }
  for (const row of equities as Array<Record<string, unknown>>) if (row.journalEntryId && String(row.type) !== 'SHARE_TRANSFER') add(`EQUITY_${String(row.type)}`, row.transactionNumber, 'equity-transaction', row._id)
  for (const row of shareholderLoans as Array<Record<string, unknown>>) {
    if (row.receiptJournalId) add('SHAREHOLDER_LOAN_RECEIPT', row.loanNumber, 'shareholder-loan', row._id)
    for (const payment of (row.payments || []) as Array<Record<string, unknown>>) if (payment.journalEntryId) add('SHAREHOLDER_LOAN_PAYMENT', payment._id, 'shareholder-loan-payment', row._id)
  }
  for (const row of dividends as Array<Record<string, unknown>>) {
    if (row.declarationJournalId) add('DIVIDEND_DECLARATION', row.dividendNumber, 'dividend', row._id)
    for (const payment of (row.payments || []) as Array<Record<string, unknown>>) if (payment.journalEntryId) add('DIVIDEND_PAYMENT', payment._id, 'dividend-payment', row._id)
  }
  for (const row of loans as Array<Record<string, unknown>>) {
    if (row.receiptJournalId) add('COMPANY_LOAN_RECEIPT', row.loanNumber, 'company-loan', row._id)
    for (const payment of (row.payments || []) as Array<Record<string, unknown>>) if (payment.journalEntryId) add('COMPANY_LOAN_PAYMENT', payment._id, 'company-loan-payment', row._id)
  }
  return rows
}

const accountNormalBalanceMinor = async (organizationId: string, accountId: unknown) => {
  if (!accountId) return null
  const account = await FinanceAccount.findOne({ _id: accountId, organizationId }).select('type').lean()
  if (!account) return null
  const [row] = await FinanceJournalLine.aggregate([
    { $match: { organizationId, accountId: account._id, journalStatus: { $in: ['POSTED', 'REVERSED'] } } },
    { $group: { _id: null, debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
  ])
  const debit = Number(row?.debitMinor || 0); const credit = Number(row?.creditMinor || 0)
  return ['ASSET', 'EXPENSE'].includes(String(account.type)) ? debit - credit : credit - debit
}

const runOrganization = async (organizationId: string) => {
  const findings: Finding[] = []
  const add = (finding: Finding) => findings.push(finding)
  const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean() as Record<string, unknown> | null
  if (!settings?.initializedAt) return { organizationId, findings, skipped: 'accounting-not-initialized' }

  const systemAccountCount = await FinanceAccount.countDocuments({ organizationId, isSystem: true })
  if (systemAccountCount === 0) add({ code: 'ACCOUNTING_NOT_INITIALIZED', severity: 'critical', message: 'Accounting settings are marked initialized but no system Chart of Accounts exists.' })
  const initialization = await FinanceAccountingInitialization.findOne({ organizationId }).sort({ createdAt: -1 }).lean()
  if (initialization?.status === 'ACTIVATED' && initialization.openingJournalId) {
    const opening = await FinanceJournalEntry.findOne({ _id: initialization.openingJournalId, organizationId }).select('_id sourceType sourceId status').lean()
    if (!opening || !['OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION'].includes(String(opening.sourceType || ''))) {
      add({ code: 'MISSING_ACCOUNTING_POSTING', severity: 'critical', message: 'Activated accounting initialization references a missing or invalid opening-balance journal.', details: { openingJournalId: oid(initialization.openingJournalId) } })
    }
  }

  const currency = String(settings.baseCurrency || '').toUpperCase()
  if (currency !== LEGACY_FINANCE_CURRENCY) add({ code: 'ACCOUNTING_CURRENCY_MISMATCH', severity: 'critical', message: `Accounting base currency is ${currency || '(blank)'}; legacy Finance requires ${LEGACY_FINANCE_CURRENCY}.` })

  const currencyCounts = await Promise.all([
    FinanceAccount.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
    FinanceBankAccount.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
    FinanceJournalEntry.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
    FinanceVendorBill.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
    FinanceClientDeposit.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
  ])
  const nonBdtTotal = currencyCounts.reduce((sum, count) => sum + count, 0)
  if (nonBdtTotal) add({ code: 'FINANCE_NON_BDT_RECORDS', severity: 'critical', message: 'Advanced Accounting contains non-BDT records.', count: nonBdtTotal, details: { accounts: currencyCounts[0], banks: currencyCounts[1], journals: currencyCounts[2], vendorBills: currencyCounts[3], deposits: currencyCounts[4] } })

  const duplicateSources = await FinanceJournalEntry.aggregate([
    { $match: { organizationId, entryRole: 'PRIMARY', sourceId: { $type: 'string', $ne: '' } } },
    { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ])
  if (duplicateSources.length) add({ code: 'DUPLICATE_ACCOUNTING_POSTING', severity: 'critical', message: 'Duplicate PRIMARY journals exist for the same source identity.', count: duplicateSources.length, details: { sources: duplicateSources.slice(0, 20).map((r) => ({ ...r._id, count: r.count, ids: r.ids.map(oid) })) } })

  const unbalanced = await FinanceJournalLine.aggregate([
    { $match: { organizationId } },
    { $group: { _id: '$journalEntryId', debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
    { $match: { $expr: { $ne: ['$debitMinor', '$creditMinor'] } } },
  ])
  if (unbalanced.length) add({ code: 'ACCOUNTING_UNBALANCED', severity: 'critical', message: 'Journal entries exist where debit does not equal credit.', count: unbalanced.length, details: { journals: unbalanced.slice(0, 20).map((r) => ({ journalEntryId: oid(r._id), debitMinor: r.debitMinor, creditMinor: r.creditMinor })) } })

  const expected = await expectedPostings(organizationId)
  const existing = expected.length
    ? await FinanceJournalEntry.find({ organizationId, entryRole: 'PRIMARY', $or: expected.map((row) => ({ sourceType: row.sourceType, sourceId: row.sourceId })) }).select('_id sourceType sourceId status').lean()
    : []
  const sourceMap = new Map(existing.map((row) => [`${row.sourceType}:${row.sourceId}`, row]))
  const missing = expected.filter((row) => !sourceMap.has(`${row.sourceType}:${row.sourceId}`))
  if (missing.length) add({ code: 'MISSING_ACCOUNTING_POSTING', severity: 'critical', message: 'Finance source records reference accounting activity but the canonical source journal is missing.', count: missing.length, details: { sources: missing.slice(0, 50) } })

  const [invoices, commissions, bills] = await Promise.all([
    FinanceInvoice.find({ organizationId, archivedAt: null, status: { $nin: ['draft', 'cancelled'] } }).select('total paidAmount').lean(),
    FinanceCommission.find({ organizationId, archivedAt: null, status: 'approved' }).select('agentShare').lean(),
    FinanceVendorBill.find({ organizationId, status: { $in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } }).select('totalMinor paidMinor').lean(),
  ])
  const expectedAr = invoices.reduce((sum, row) => sum + Math.max(0, moneyToMinorUnits(Number(row.total || 0), 'invoice total') - moneyToMinorUnits(Number(row.paidAmount || 0), 'invoice paid amount')), 0)
  const expectedCommission = commissions.reduce((sum, row) => sum + moneyToMinorUnits(Number(row.agentShare || 0), 'commission agent share'), 0)
  const expectedAp = bills.reduce((sum, row) => sum + Math.max(0, Number(row.totalMinor || 0) - Number(row.paidMinor || 0)), 0)
  const defaults = (settings.defaultAccounts || {}) as Record<string, unknown>
  const [glAr, glCommission, glAp] = await Promise.all([
    accountNormalBalanceMinor(organizationId, defaults.accountsReceivable),
    accountNormalBalanceMinor(organizationId, defaults.commissionPayable),
    accountNormalBalanceMinor(organizationId, defaults.accountsPayable),
  ])
  const compare = (code: string, label: string, expectedMinor: number, actualMinor: number | null) => {
    if (actualMinor === null) add({ code: 'INVALID_ACCOUNT_MAPPING', severity: 'critical', message: `${label} default GL account is missing or invalid.` })
    else if (actualMinor !== expectedMinor) add({ code, severity: 'warning', message: `${label} subledger does not equal its GL control account.`, details: { expectedMinor, glMinor: actualMinor, differenceMinor: actualMinor - expectedMinor } })
  }
  compare('AR_RECONCILIATION_MISMATCH', 'Accounts Receivable', expectedAr, glAr)
  compare('COMMISSION_RECONCILIATION_MISMATCH', 'Commission Payable', expectedCommission, glCommission)
  compare('AP_RECONCILIATION_MISMATCH', 'Accounts Payable', expectedAp, glAp)

  const banks = await FinanceBankAccount.find({ organizationId, status: 'ACTIVE' }).select('_id name glAccountId currency').lean()
  const bankRows: Array<Record<string, unknown>> = []
  for (const bank of banks) {
    const ledgerBalanceMinor = await accountNormalBalanceMinor(organizationId, bank.glAccountId)
    const latest = await FinanceReconciliation.findOne({ organizationId, bankAccountId: bank._id }).sort({ reconciledAt: -1 }).lean()
    bankRows.push({ bankAccountId: oid(bank._id), name: bank.name, ledgerBalanceMinor, latestReconciliation: latest ? { statementClosingBalanceMinor: latest.statementClosingBalanceMinor, ledgerClosingBalanceMinor: latest.ledgerClosingBalanceMinor, differenceMinor: latest.differenceMinor, reconciledAt: latest.reconciledAt } : null })
    if (latest && Number(latest.differenceMinor || 0) !== 0) add({ code: 'BANK_RECONCILIATION_MISMATCH', severity: 'warning', message: `${bank.name} has a non-zero saved reconciliation difference.`, details: { bankAccountId: oid(bank._id), differenceMinor: latest.differenceMinor } })
  }

  return { organizationId, findings, reconciled: { ar: { expectedMinor: expectedAr, glMinor: glAr }, commissionPayable: { expectedMinor: expectedCommission, glMinor: glCommission }, ap: { expectedMinor: expectedAp, glMinor: glAp }, bankAccounts: bankRows }, sourceCoverage: { expected: expected.length, found: existing.length, missing: missing.length } }
}

const run = async () => {
  await connect()
  try {
    const filter = scopedOrganization ? { organizationId: scopedOrganization } : {}
    const organizations = await Organization.find(filter).select('organizationId agencyName').sort({ organizationId: 1 }).lean()
    const reports = []
    let critical = 0; let warnings = 0
    for (const organization of organizations) {
      const report = await runOrganization(String(organization.organizationId))
      reports.push({ agencyName: organization.agencyName, ...report })
      for (const finding of report.findings) { if (finding.severity === 'critical') critical += 1; if (finding.severity === 'warning') warnings += 1 }
    }
    const output = { audit: 'finance-phase2-reconciliation', readOnly: true, generatedAt: new Date().toISOString(), currencyContract: LEGACY_FINANCE_CURRENCY, organizationCount: organizations.length, summary: { critical, warnings }, organizations: reports }
    console.log(JSON.stringify(output, null, 2))
    if (failOnFindings && (critical > 0 || warnings > 0)) process.exitCode = 2
  } finally { await mongoose.disconnect() }
}

run().catch((error) => { console.error('[finance-phase2-reconciliation] failed', error); process.exitCode = 1 }).finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect().catch(() => undefined) })
