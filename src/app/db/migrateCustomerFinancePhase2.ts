import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli } from './migrations/migrationSafety'

const MIGRATION = 'customer-finance-phase2'

type IndexSpec = {
  keys: Record<string, 1 | -1>
  options: any
}

const collections: Array<{ name: string; indexes: IndexSpec[] }> = [
  {
    name: 'salebookings',
    indexes: [
      { keys: { organizationId: 1, bookingNumber: 1 }, options: { unique: true, name: 'sale_booking_tenant_number_unique' } },
      { keys: { organizationId: 1, contactId: 1, createdAt: -1 }, options: { name: 'sale_booking_tenant_contact_created' } },
      { keys: { organizationId: 1, propertyId: 1, createdAt: -1 }, options: { name: 'sale_booking_tenant_property_created' } },
      {
        keys: { activePropertyKey: 1 },
        options: {
          unique: true,
          name: 'sale_booking_one_open_property_unique',
          partialFilterExpression: { activePropertyKey: { $type: 'string' } },
        },
      },
    ],
  },
  {
    name: 'installments',
    indexes: [
      { keys: { organizationId: 1, bookingId: 1, sequence: 1 }, options: { unique: true, name: 'installment_tenant_booking_sequence_unique' } },
      { keys: { organizationId: 1, bookingId: 1, dueDate: 1, sequence: 1 }, options: { name: 'installment_tenant_booking_due' } },
      { keys: { organizationId: 1, status: 1, dueDate: 1 }, options: { name: 'installment_tenant_status_due' } },
    ],
  },
  {
    name: 'financeinvoices',
    indexes: [
      {
        keys: { organizationId: 1, bookingId: 1 },
        options: {
          unique: true,
          name: 'finance_invoice_tenant_booking_unique',
          partialFilterExpression: { bookingId: { $type: 'objectId' } },
        },
      },
      { keys: { organizationId: 1, contactId: 1, createdAt: -1 }, options: { name: 'finance_invoice_tenant_contact_created' } },
    ],
  },
]

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const inspection = []
  for (const spec of collections) {
    const exists = (await db.listCollections({ name: spec.name }).toArray()).length > 0
    const existingNames = exists
      ? new Set((await db.collection(spec.name).indexes()).map((row: any) => String(row.name)))
      : new Set<string>()
    inspection.push({
      collection: spec.name,
      exists,
      indexes: spec.indexes.map((index) => ({
        name: String(index.options.name),
        present: existingNames.has(String(index.options.name)),
      })),
    })
  }

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    collections: inspection,
    documentMutation: false,
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  for (const spec of collections) {
    const exists = (await db.listCollections({ name: spec.name }).toArray()).length > 0
    if (!exists) await db.createCollection(spec.name)
    const collection = db.collection(spec.name)
    for (const index of spec.indexes) {
      await collection.createIndex(index.keys, index.options)
      console.log(`[${MIGRATION}] index ready ${spec.name}.${String(index.options.name)}`)
    }
  }

  console.log(`[${MIGRATION}] completed`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
