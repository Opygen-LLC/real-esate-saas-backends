import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccount } from '../module/finance/financeAccounting.model'
import { FinanceShareholder, FinanceEquityTransaction, FinanceShareholderLoan, FinanceDividend, FinanceLoan } from '../module/finance/financeCapital.model'
import { FinanceCapitalService } from '../module/finance/financeCapital.service'

const run = async () => {
  await mongoose.connect(config.database_string as string)
  await Promise.all([FinanceShareholder.syncIndexes(), FinanceEquityTransaction.syncIndexes(), FinanceShareholderLoan.syncIndexes(), FinanceDividend.syncIndexes(), FinanceLoan.syncIndexes()])
  const initialized = await FinanceAccount.find({ systemKey: 'ASSETS_ROOT' }).select('organizationId createdBy').lean()
  let prepared = 0
  for (const root of initialized) {
    const actorId = root.createdBy ? String(root.createdBy) : ''
    if (!mongoose.isValidObjectId(actorId)) continue
    await FinanceCapitalService.initializeCapital(root.organizationId, { id: actorId, role: 'system', system: true })
    prepared += 1
  }
  console.log(`Advanced Accounting Phase 5 migration completed. Capital accounting prepared for ${prepared} initialized organization(s).`)
  await mongoose.disconnect()
}
run().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => undefined); process.exit(1) })
