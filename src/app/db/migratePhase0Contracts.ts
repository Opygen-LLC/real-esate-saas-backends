import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase0-contracts'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const indexes = [
    ['subscriptionpayments', { organizationId: 1, createdAt: -1 }, { name: 'tenant_created' }],
    ['subscriptionpayments', { organizationId: 1, status: 1, createdAt: -1 }, { name: 'tenant_status_created' }],
    ['subscriptionpayments', { status: 1, createdAt: -1 }, { name: 'status_created' }],
    ['subscriptionpayments', { organizationId: 1, method: 1, reference: 1 }, { name: 'tenant_method_reference', unique: true, partialFilterExpression: { reference: { $type: 'string', $gt: '' } } }],
    ['subscriptionchangerequests', { organizationId: 1, createdAt: -1 }, { name: 'tenant_created' }],
    ['subscriptionchangerequests', { organizationId: 1, status: 1, createdAt: -1 }, { name: 'tenant_status_created' }],
    ['subscriptionchangerequests', { status: 1, createdAt: -1 }, { name: 'status_created' }],
    ['subscriptionchangerequests', { organizationId: 1, status: 1 }, { name: 'one_open_subscription_change_per_tenant', unique: true, partialFilterExpression: { status: { $in: ['pending_payment', 'payment_submitted'] } } }],
    ['consentrecords', { organizationId: 1, purpose: 1, capturedAt: -1 }, { name: 'tenant_purpose_captured' }],
    ['consentrecords', { organizationId: 1, userId: 1, purpose: 1, capturedAt: -1 }, { name: 'tenant_user_purpose_captured' }],
  ] as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=${indexes.length}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const applied: string[] = []
  for (const [collectionName, keys, options] of indexes) {
    const collection = db.collection(collectionName)
    await collection.createIndex(keys as any, options as any)
    applied.push(`${collectionName}.${options.name}`)
  }
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { appliedIndexes: applied })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
