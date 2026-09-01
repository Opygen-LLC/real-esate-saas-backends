import mongoose from 'mongoose'
import config from '../../config'
import { FinanceAccount } from '../module/finance/financeAccounting.model'
import { FinanceAccountingSettings } from '../module/finance/financeAccountingSettings.model'
import {
  FinanceBankAccount, FinanceBankStatement, FinanceBankStatementLine, FinanceBankTransfer,
  FinanceClientDeposit, FinanceReconciliation, FinanceTaxCode, FinanceVendorBill,
} from '../module/finance/financeOperations.model'
import { FinanceOperationsService } from '../module/finance/financeOperations.service'
import { FinanceInvoice, FinanceTransaction } from '../module/finance/finance.model'

const run = async () => {
  await mongoose.connect(config.database_string as string)
  await Promise.all([
    FinanceAccountingSettings.syncIndexes(), FinanceAccount.syncIndexes(), FinanceInvoice.syncIndexes(), FinanceTransaction.syncIndexes(),
    FinanceBankAccount.syncIndexes(), FinanceVendorBill.syncIndexes(), FinanceBankTransfer.syncIndexes(), FinanceBankStatement.syncIndexes(),
    FinanceBankStatementLine.syncIndexes(), FinanceReconciliation.syncIndexes(), FinanceClientDeposit.syncIndexes(), FinanceTaxCode.syncIndexes(),
  ])

  const initialized = await FinanceAccount.find({ systemKey: 'ASSETS_ROOT' }).select('organizationId createdBy').lean()
  let prepared = 0
  for (const root of initialized) {
    const actorId = root.createdBy ? String(root.createdBy) : ''
    if (!mongoose.isValidObjectId(actorId)) continue
    await FinanceOperationsService.initializeOperations(root.organizationId, { id: actorId, role: 'system', system: true })
    prepared += 1
  }

  console.log(`Advanced Accounting Phase 4 migration completed. Operational accounting prepared for ${prepared} initialized organization(s).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
