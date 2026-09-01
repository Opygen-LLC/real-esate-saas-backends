import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import { FinanceAccount, FinanceJournalEntry } from '../module/finance/financeAccounting.model'
import { FinanceBankAccount, FinanceVendorBill, FinanceClientDeposit } from '../module/finance/financeOperations.model'
import { LEGACY_FINANCE_CURRENCY } from '../module/finance/finance.contract'

const organizationId = process.argv.find((arg) => arg.startsWith('--organization='))?.split('=', 2)[1]?.trim()
const apply = process.argv.includes('--apply')
if (!organizationId) throw new Error('Pass --organization=<organizationId>. Repairs are intentionally tenant-scoped.')

const run = async () => {
  await mongoose.connect(config.database_string as string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms, connectTimeoutMS: config.mongo.connect_timeout_ms })
  try {
    const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean()
    if (!settings) throw new Error(`Accounting settings not found for ${organizationId}`)
    const postedCount = await FinanceJournalEntry.countDocuments({ organizationId, status: { $in: ['POSTED', 'REVERSED'] } })
    const affected = {
      settings: String(settings.baseCurrency || '').toUpperCase() === LEGACY_FINANCE_CURRENCY ? 0 : 1,
      accounts: await FinanceAccount.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
      bankAccounts: await FinanceBankAccount.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
      vendorBills: await FinanceVendorBill.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
      clientDeposits: await FinanceClientDeposit.countDocuments({ organizationId, currency: { $ne: LEGACY_FINANCE_CURRENCY } }),
    }
    const totalAffected = Object.values(affected).reduce((sum, count) => sum + count, 0)
    const plan = { repair: 'finance-phase2-bdt-contract', organizationId, apply, safeToApply: postedCount === 0, postedOrReversedJournals: postedCount, affected, rule: 'Currency labels may only be normalized automatically before any posted/reversed journal exists. Historical posted ledgers require an explicit audited conversion project.' }
    console.log(JSON.stringify(plan, null, 2))
    if (!totalAffected) return
    if (!apply) { console.log('DRY RUN ONLY. Re-run with --apply after reviewing the plan.'); return }
    if (postedCount > 0) throw new Error('Refusing automatic currency repair: posted/reversed journals exist. Do not relabel historical accounting records without a full multi-currency conversion and audit.')
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { baseCurrency: LEGACY_FINANCE_CURRENCY } }, { session })
        await FinanceAccount.updateMany({ organizationId }, { $set: { currency: LEGACY_FINANCE_CURRENCY } }, { session })
        await FinanceBankAccount.updateMany({ organizationId }, { $set: { currency: LEGACY_FINANCE_CURRENCY } }, { session })
        await FinanceVendorBill.updateMany({ organizationId }, { $set: { currency: LEGACY_FINANCE_CURRENCY } }, { session })
        await FinanceClientDeposit.updateMany({ organizationId }, { $set: { currency: LEGACY_FINANCE_CURRENCY } }, { session })
      })
    } finally { await session.endSession() }
    console.log(JSON.stringify({ repaired: true, organizationId, currency: LEGACY_FINANCE_CURRENCY, affected }, null, 2))
  } finally { await mongoose.disconnect() }
}

run().catch((error) => { console.error('[finance-phase2-repair] failed', error); process.exitCode = 1 }).finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect().catch(() => undefined) })
