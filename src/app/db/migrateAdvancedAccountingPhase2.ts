import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import {
  FinanceAccount,
  FinanceAccountingSequence,
  FinanceFiscalPeriod,
  FinanceFiscalYear,
  FinanceJournalEntry,
  FinanceJournalLine,
} from '../module/finance/financeAccounting.model'

const run = async () => {
  await mongoose.connect(config.database_string as string)
  await Promise.all([
    FinanceAccountingSettings.syncIndexes(),
    FinanceAccount.syncIndexes(),
    FinanceFiscalYear.syncIndexes(),
    FinanceFiscalPeriod.syncIndexes(),
    FinanceJournalEntry.syncIndexes(),
    FinanceJournalLine.syncIndexes(),
    FinanceAccountingSequence.syncIndexes(),
  ])
  console.log('Advanced Accounting Phase 2 migration completed. Double-entry accounting indexes are ready.')
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
