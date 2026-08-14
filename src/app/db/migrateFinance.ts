import mongoose from 'mongoose'
import config from '../../config'

async function run() {
  await mongoose.connect(config.database_string as string)
  const db = mongoose.connection.db
  if (!db) throw new Error('Database connection unavailable')

  const collections = [
    ['financetransactions', [
      [{ organizationId: 1, transactionDate: -1, type: 1, status: 1 }, { name: 'tenant_date_type_status' }],
      [{ organizationId: 1, category: 1, transactionDate: -1 }, { name: 'tenant_category_date' }],
      [{ organizationId: 1, sourceType: 1, sourceId: 1 }, { name: 'tenant_source' }],
    ]],
    ['financeinvoices', [
      [{ organizationId: 1, invoiceNumber: 1 }, { name: 'tenant_invoice_number', unique: true }],
      [{ organizationId: 1, status: 1, dueDate: 1 }, { name: 'tenant_status_due' }],
      [{ organizationId: 1, issueDate: -1 }, { name: 'tenant_issue_date' }],
    ]],
    ['financecommissions', [
      [{ organizationId: 1, commissionNumber: 1 }, { name: 'tenant_commission_number', unique: true }],
      [{ organizationId: 1, status: 1, dueDate: 1 }, { name: 'tenant_status_due' }],
      [{ organizationId: 1, agentId: 1, createdAt: -1 }, { name: 'tenant_agent_created' }],
    ]],
    ['financevendors', [
      [{ organizationId: 1, name: 1 }, { name: 'tenant_name' }],
      [{ organizationId: 1, status: 1, category: 1 }, { name: 'tenant_status_category' }],
    ]],
    ['financebudgets', [
      [{ organizationId: 1, status: 1, startDate: 1, endDate: 1 }, { name: 'tenant_status_range' }],
      [{ organizationId: 1, category: 1, startDate: 1, endDate: 1 }, { name: 'tenant_category_range' }],
    ]],
  ] as const

  for (const [name, indexes] of collections) {
    const existing = (await db.listCollections({ name }).toArray()).length > 0
    if (!existing) await db.createCollection(name)
    const collection = db.collection(name)
    for (const [keys, options] of indexes) await collection.createIndex(keys as any, options as any)
    console.log(`Finance indexes ready: ${name}`)
  }

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
