import mongoose from 'mongoose'
import config from '../../config'
import { FinanceTransaction, FinanceVendor } from '../module/finance/finance.model'
import { StockMovement } from '../module/materialInventory/stockMovement.model'
import { MaterialPurchase } from '../module/supplierManagement/materialPurchase.model'
import { MaterialPurchaseReceipt } from '../module/supplierManagement/materialPurchaseReceipt.model'
import { SupplierInvoiceAsset } from '../module/supplierManagement/supplierInvoiceAsset.model'

const apply = process.argv.includes('--apply')

async function run() {
  if (!config.database_url) throw new Error('DATABASE_URL is required')
  await mongoose.connect(config.database_url)
  try {
    const collections = [FinanceVendor, FinanceTransaction, StockMovement, MaterialPurchase, MaterialPurchaseReceipt, SupplierInvoiceAsset]
    const report: Array<Record<string, unknown>> = []
    for (const model of collections) {
      const exists = await mongoose.connection.db?.listCollections({ name: model.collection.name }).hasNext()
      report.push({ model: model.modelName, collection: model.collection.name, exists: Boolean(exists) })
      if (apply) {
        if (!exists) await model.createCollection()
        await model.createIndexes()
      }
    }
    console.log(JSON.stringify({ apply, phase: 'supplier_management_phase4', collections: report }, null, 2))
    if (!apply) console.log('Dry run only. Re-run with --apply to create Phase 4 collections and indexes.')
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
