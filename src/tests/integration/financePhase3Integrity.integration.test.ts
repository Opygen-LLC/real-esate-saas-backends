import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

suite('Finance Phase 3 accounting integrity', () => {
  const organizationId = `phase3-ci-${new mongoose.Types.ObjectId().toHexString()}`
  const actorId = new mongoose.Types.ObjectId().toHexString()
  const actor = { id: actorId, role: 'agency-owner', requestId: 'phase3-integrity-ci' }

  let FinanceAccountingService: typeof import('../../app/module/finance/financeAccounting.service').FinanceAccountingService
  let FinanceOperationsService: typeof import('../../app/module/finance/financeOperations.service').FinanceOperationsService
  let FinanceReportingService: typeof import('../../app/module/finance/financeReporting.service').FinanceReportingService
  let FinanceAccount: typeof import('../../app/module/finance/financeAccounting.model').FinanceAccount
  let FinanceFiscalPeriod: typeof import('../../app/module/finance/financeAccounting.model').FinanceFiscalPeriod
  let FinanceJournalEntry: typeof import('../../app/module/finance/financeAccounting.model').FinanceJournalEntry
  let FinanceJournalLine: typeof import('../../app/module/finance/financeAccounting.model').FinanceJournalLine
  let FinanceAccountingSettings: typeof import('../../app/module/finance/financeAccountingSettings.model').FinanceAccountingSettings
  let FinanceVendor: typeof import('../../app/module/finance/finance.model').FinanceVendor

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb
    process.env.REDIS_ENABLED = 'false'
    process.env.ENABLE_WORKERS = 'false'
    await mongoose.connect(requiredDb as string)
    ;({ FinanceAccountingService } = await import('../../app/module/finance/financeAccounting.service'))
    ;({ FinanceOperationsService } = await import('../../app/module/finance/financeOperations.service'))
    ;({ FinanceReportingService } = await import('../../app/module/finance/financeReporting.service'))
    ;({ FinanceAccount, FinanceFiscalPeriod, FinanceJournalEntry, FinanceJournalLine } = await import('../../app/module/finance/financeAccounting.model'))
    ;({ FinanceAccountingSettings } = await import('../../app/module/finance/financeAccountingSettings.model'))
    ;({ FinanceVendor } = await import('../../app/module/finance/finance.model'))
    await FinanceAccountingService.initialize(organizationId, actor)
    await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { makerCheckerRequired: false, activationStatus: 'ACTIVE' } })
  }, 30_000)

  afterAll(async () => {
    if (mongoose.connection.db) {
      for (const collection of await mongoose.connection.db.collections()) {
        await collection.deleteMany({ organizationId }).catch(() => undefined)
      }
    }
    await mongoose.disconnect().catch(() => undefined)
  })

  const account = async (systemKey: string) => {
    const row = await FinanceAccount.findOne({ organizationId, systemKey }).lean()
    expect(row, `missing system account ${systemKey}`).toBeTruthy()
    return row as NonNullable<typeof row>
  }

  const normalBalance = async (accountId: mongoose.Types.ObjectId | string) => {
    const gl = await FinanceAccount.findOne({ _id: accountId, organizationId }).lean()
    expect(gl).toBeTruthy()
    const rows = await FinanceJournalLine.aggregate([
      { $match: { organizationId, accountId: new mongoose.Types.ObjectId(String(accountId)), journalStatus: { $in: ['POSTED', 'REVERSED'] } } },
      { $group: { _id: null, debit: { $sum: '$debitMinor' }, credit: { $sum: '$creditMinor' } } },
    ])
    const signed = Number(rows[0]?.debit || 0) - Number(rows[0]?.credit || 0)
    return gl?.normalBalance === 'DEBIT' ? signed : -signed
  }

  const postSource = async (sourceType: string, sourceId: string, lines: Array<{ accountId: string; debitMinor?: number; creditMinor?: number }>, postingDate = new Date()) => {
    const draft = await FinanceAccountingService.createJournalDraftInternal(organizationId, actor, {
      entryDate: postingDate,
      postingDate,
      description: `${sourceType} integrity fixture`,
      reference: sourceId,
      lines,
    }, { sourceType, sourceId, idempotencyKey: `${sourceType}:${sourceId}` })
    return FinanceAccountingService.postJournalInternal(organizationId, actor, String((draft as any)._id))
  }

  it('proves balanced GL, subledger reductions, transfer symmetry, immutable reversal, period lock and source idempotency', async () => {
    const bank = await account('OPERATING_BANK')
    const ar = await account('ACCOUNTS_RECEIVABLE')
    const revenue = await account('SALES_COMMISSION_REVENUE')
    const commissionExpense = await account('COMMISSION_EXPENSE')
    const commissionPayable = await account('COMMISSION_PAYABLE')
    const ap = await account('ACCOUNTS_PAYABLE')
    const retained = await account('RETAINED_EARNINGS')

    // Invoice + payment: the Accounts Receivable control balance must fall by the payment amount.
    await postSource('INVOICE_REVENUE', 'invoice-phase3:v1', [
      { accountId: String(ar._id), debitMinor: 100_000 },
      { accountId: String(revenue._id), creditMinor: 100_000 },
    ])
    expect(await normalBalance(ar._id)).toBe(100_000)
    await postSource('INVOICE_PAYMENT', 'invoice-payment-phase3', [
      { accountId: String(bank._id), debitMinor: 40_000 },
      { accountId: String(ar._id), creditMinor: 40_000 },
    ])
    expect(await normalBalance(ar._id)).toBe(60_000)

    // Commission accrual + payout: the payable must be cleared by the payout journal.
    await postSource('COMMISSION_ACCRUAL', 'commission-phase3:v1', [
      { accountId: String(commissionExpense._id), debitMinor: 30_000 },
      { accountId: String(commissionPayable._id), creditMinor: 30_000 },
    ])
    expect(await normalBalance(commissionPayable._id)).toBe(30_000)
    await postSource('COMMISSION_PAYOUT', 'commission-payout-phase3', [
      { accountId: String(commissionPayable._id), debitMinor: 30_000 },
      { accountId: String(bank._id), creditMinor: 30_000 },
    ])
    expect(await normalBalance(commissionPayable._id)).toBe(0)

    // Real AP workflow: post a vendor bill and pay part of it through FinanceOperationsService.
    const vendor = await FinanceVendor.create({ organizationId, name: 'Phase 3 CI Vendor', category: 'Testing', status: 'active', createdBy: actorId })
    const bill = await FinanceOperationsService.createVendorBill(organizationId, actor, {
      vendorId: String(vendor._id),
      billDate: new Date(),
      lines: [{ description: 'Phase 3 service', accountId: String(commissionExpense._id), amount: 250 }],
    })
    await FinanceOperationsService.approveVendorBill(organizationId, actor, String((bill as any)._id))
    await FinanceOperationsService.postVendorBill(organizationId, actor, String((bill as any)._id))
    const apBeforePayment = await normalBalance(ap._id)
    expect(apBeforePayment).toBeGreaterThanOrEqual(25_000)
    const operatingBank = (await FinanceOperationsService.listBankAccounts(organizationId))[0] as any
    await FinanceOperationsService.payVendorBill(organizationId, actor, String((bill as any)._id), { amount: 100, bankAccountId: String(operatingBank._id), paidAt: new Date() })
    expect(await normalBalance(ap._id)).toBe(apBeforePayment - 10_000)

    // Real bank transfer workflow: each transfer has equal and opposite bank GL lines.
    const secondaryGl = await FinanceAccountingService.createAccount(organizationId, actor, { code: '1199', name: 'Phase 3 Secondary Bank GL', type: 'ASSET', currency: 'BDT' }) as any
    const secondaryBank = await FinanceOperationsService.createBankAccount(organizationId, actor, { name: 'Phase 3 Secondary Bank', type: 'CHECKING', glAccountId: String(secondaryGl._id) }) as any
    const transfer = await FinanceOperationsService.transferBankFunds(organizationId, actor, { sourceBankAccountId: String(operatingBank._id), destinationBankAccountId: String(secondaryBank._id), amount: 50, transferDate: new Date() }) as any
    const transferLines = await FinanceJournalLine.find({ organizationId, journalEntryId: transfer.journalEntryId }).lean()
    expect(transferLines.reduce((sum, line) => sum + Number(line.debitMinor), 0)).toBe(5_000)
    expect(transferLines.reduce((sum, line) => sum + Number(line.creditMinor), 0)).toBe(5_000)

    // Reversal must preserve the original numeric lines and create a separate opposite journal.
    const reversible = await postSource('PHASE3_REVERSAL_TEST', 'reversal-source', [
      { accountId: String(bank._id), debitMinor: 12_345 },
      { accountId: String(retained._id), creditMinor: 12_345 },
    ]) as any
    const beforeLines = await FinanceJournalLine.find({ organizationId, journalEntryId: reversible._id }).sort({ lineNumber: 1 }).lean()
    const beforeNumeric = beforeLines.map((line) => ({ debitMinor: line.debitMinor, creditMinor: line.creditMinor, accountId: String(line.accountId) }))
    const reversed = await FinanceAccountingService.reverseJournal(organizationId, actor, String(reversible._id), { reason: 'Phase 3 immutable reversal proof', reversalDate: new Date() }) as any
    const afterLines = await FinanceJournalLine.find({ organizationId, journalEntryId: reversible._id }).sort({ lineNumber: 1 }).lean()
    expect(afterLines.map((line) => ({ debitMinor: line.debitMinor, creditMinor: line.creditMinor, accountId: String(line.accountId) }))).toEqual(beforeNumeric)
    expect((await FinanceJournalEntry.findById(reversible._id).lean())?.status).toBe('REVERSED')
    const reversalLines = await FinanceJournalLine.find({ organizationId, journalEntryId: reversed.reversal._id }).sort({ lineNumber: 1 }).lean()
    expect(reversalLines[0].debitMinor).toBe(beforeLines[0].creditMinor)
    expect(reversalLines[0].creditMinor).toBe(beforeLines[0].debitMinor)

    // The same canonical source identity cannot create a second PRIMARY journal.
    await expect(FinanceAccountingService.createJournalDraftInternal(organizationId, actor, {
      entryDate: new Date(), postingDate: new Date(), description: 'duplicate source attempt',
      lines: [{ accountId: String(bank._id), debitMinor: 100 }, { accountId: String(retained._id), creditMinor: 100 }],
    }, { sourceType: 'INVOICE_REVENUE', sourceId: 'invoice-phase3:v1', idempotencyKey: 'another-idempotency-key' }))
      .rejects.toMatchObject({ code: 'DUPLICATE_ACCOUNTING_POSTING' })

    // A closed fiscal period rejects new posting at the ledger boundary.
    const currentPeriod = await FinanceFiscalPeriod.findOne({ organizationId, startDate: { $lte: new Date() }, endDate: { $gte: new Date() } }).lean()
    expect(currentPeriod).toBeTruthy()
    await FinanceFiscalPeriod.updateOne({ _id: currentPeriod?._id }, { $set: { status: 'CLOSED', closedAt: new Date(), closedBy: actorId } })
    await expect(FinanceAccountingService.createJournalDraftInternal(organizationId, actor, {
      entryDate: new Date(), postingDate: new Date(), description: 'closed period proof',
      lines: [{ accountId: String(bank._id), debitMinor: 100 }, { accountId: String(retained._id), creditMinor: 100 }],
    }, { sourceType: 'PHASE3_CLOSED_PERIOD', sourceId: 'closed-period-source' }))
      .rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_CLOSED' })
    await FinanceFiscalPeriod.updateOne({ _id: currentPeriod?._id }, { $set: { status: 'OPEN', closedAt: null, closedBy: null } })

    // Final invariant checks: every journal is balanced and Assets = Liabilities + Equity.
    const unbalanced = await FinanceJournalLine.aggregate([
      { $match: { organizationId } },
      { $group: { _id: '$journalEntryId', debitMinor: { $sum: '$debitMinor' }, creditMinor: { $sum: '$creditMinor' } } },
      { $match: { $expr: { $ne: ['$debitMinor', '$creditMinor'] } } },
    ])
    expect(unbalanced).toHaveLength(0)
    const trialBalance = await FinanceReportingService.trialBalance(organizationId, { includeZero: 'true' })
    expect(trialBalance.balanced).toBe(true)
    expect(trialBalance.totals.periodDebitMinor).toBe(trialBalance.totals.periodCreditMinor)
    const balanceSheet = await FinanceReportingService.balanceSheet(organizationId, { includeZero: 'true' })
    expect(balanceSheet.summary.balanced).toBe(true)
    expect(balanceSheet.summary.totalAssetsMinor).toBe(balanceSheet.summary.liabilitiesAndEquityMinor)
  }, 45_000)
})
