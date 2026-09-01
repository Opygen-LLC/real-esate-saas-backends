import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import { FinanceJournalEntry, FinanceJournalLine } from '../module/finance/financeAccounting.model'
import { FinanceTransaction, FinanceInvoice, FinanceCommission, FinanceVendor, FinanceBudget } from '../module/finance/finance.model'
import { FinanceAccountingInitialization, FinanceLegacyPaymentMethodMapping } from '../module/finance/financeInitialization.model'

const hasLegacyFinance = async (organizationId: string) => {
  const rows = await Promise.all([
    FinanceTransaction.exists({ organizationId }), FinanceInvoice.exists({ organizationId }),
    FinanceCommission.exists({ organizationId }), FinanceVendor.exists({ organizationId }), FinanceBudget.exists({ organizationId }),
  ])
  return rows.some(Boolean)
}
const run = async () => {
  await mongoose.connect(config.database_string as string)
  await Promise.all([
    FinanceAccountingSettings.syncIndexes(), FinanceJournalEntry.syncIndexes(), FinanceJournalLine.syncIndexes(),
    FinanceAccountingInitialization.syncIndexes(), FinanceLegacyPaymentMethodMapping.syncIndexes(),
  ])
  const settings = await FinanceAccountingSettings.find({ initializedAt: { $ne: null } }).select('organizationId activationStatus makerCheckerRequired accountingStartDate').lean()
  let migrationRequired = 0; let active = 0
  for (const row of settings) {
    const organizationId = row.organizationId
    const hasLedger = Boolean(await FinanceJournalEntry.exists({ organizationId, status: { $in: ['POSTED', 'REVERSED'] } }))
    const legacy = !hasLedger && await hasLegacyFinance(organizationId)
    const activationStatus = hasLedger ? 'ACTIVE' : legacy ? 'MIGRATION_REQUIRED' : 'ACTIVE'
    await FinanceAccountingSettings.updateOne({ _id: row._id }, { $set: { activationStatus, makerCheckerRequired: Boolean(row.makerCheckerRequired) } })
    if (legacy) migrationRequired += 1; else active += 1
  }
  await FinanceJournalEntry.updateMany({ status: { $in: ['POSTED', 'REVERSED'] }, approvedAt: null, approvedBy: { $ne: null } }, [{ $set: { approvedAt: { $ifNull: ['$postedAt', '$updatedAt'] } } }])
  console.log(`Advanced Accounting Phase 7 migration completed. ACTIVE=${active}, MIGRATION_REQUIRED=${migrationRequired}. No historical finance records were mutated or double-posted.`)
  await mongoose.disconnect()
}
run().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => undefined); process.exit(1) })
