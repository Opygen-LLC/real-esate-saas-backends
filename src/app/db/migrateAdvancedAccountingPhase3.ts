import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import { FinanceCommission, FinanceInvoice, FinanceTransaction } from '../module/finance/finance.model'
import {
  FinanceAccount,
  FinanceCategoryAccountMapping,
  FinanceJournalEntry,
} from '../module/finance/financeAccounting.model'
import { FinanceCategoryMappingService } from '../module/finance/financeCategoryMapping.service'

const run = async () => {
  await mongoose.connect(config.database_string as string)

  await Promise.all([
    FinanceAccountingSettings.syncIndexes(),
    FinanceAccount.syncIndexes(),
    FinanceCategoryAccountMapping.syncIndexes(),
    FinanceJournalEntry.syncIndexes(),
    FinanceTransaction.syncIndexes(),
    FinanceInvoice.syncIndexes(),
    FinanceCommission.syncIndexes(),
  ])

  // Existing Phase 2 organizations need the new 5900 account and deterministic
  // operational category mappings. This is idempotent and does not post any
  // historical journals; historical conversion remains a later migration phase.
  const initializedOrganizations = await FinanceAccount.find({ systemKey: 'ASSETS_ROOT' })
    .select('organizationId createdBy')
    .lean()

  let seeded = 0
  for (const root of initializedOrganizations) {
    const createdBy = root.createdBy ? String(root.createdBy) : ''
    if (!mongoose.isValidObjectId(createdBy)) continue
    await FinanceCategoryMappingService.ensureDefaults(
      root.organizationId,
      { id: createdBy, role: 'system', system: true },
    )
    seeded += 1
  }

  console.log(`Advanced Accounting Phase 3 migration completed. Category mappings prepared for ${seeded} initialized organization(s).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
