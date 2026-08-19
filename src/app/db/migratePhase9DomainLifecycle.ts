import mongoose from 'mongoose'
import config from '../../config'
import { DomainRecord } from '../module/domain/domain.model'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase9-domain-lifecycle'
const CONFIRMATION = 'PHASE9-DOMAIN-LIFECYCLE'

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const filter = {
    $or: [
      { lifecycleStatus: { $exists: false } },
      { provider: { $exists: false } },
      { providerRegistrationStatus: { $exists: false } },
      { publicRoutingStatus: { $exists: false } },
    ],
  }
  const collection = DomainRecord.collection
  const count = await collection.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} records=${count}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No records changed. Use --apply --confirm=${CONFIRMATION} after reviewing this plan.`)
    return
  }

  const backup = count
    ? await backupDocuments({ collection, filter, migrationName: MIGRATION, backupDir: cli.backupDir })
    : null
  const cursor = collection.find(filter)
  let updated = 0

  for await (const record of cursor) {
    const active = record.status === 'verified' && record.tlsStatus === 'active'
    const lifecycleStatus = active
      ? 'ACTIVE'
      : record.status === 'verified'
        ? 'TLS_PROVISIONING'
        : 'PENDING_DNS'

    const result = await collection.updateOne(
      { _id: record._id, ...filter },
      {
        $set: {
          lifecycleStatus,
          provider: record.provider || config.domains.provider,
          providerRegistrationStatus: active || record.status === 'verified' ? 'registered' : (record.providerRegistrationStatus || 'pending'),
          publicRoutingStatus: active ? 'active' : (record.publicRoutingStatus || 'pending'),
          failureReason: record.failureReason || '',
          nextCheckAt: record.nextCheckAt || new Date(),
          ...(active ? {
            providerRegisteredAt: record.providerRegisteredAt || record.verifiedAt || record.updatedAt || new Date(),
            tlsActiveAt: record.tlsActiveAt || record.verifiedAt || record.updatedAt || new Date(),
            activeAt: record.activeAt || record.verifiedAt || record.updatedAt || new Date(),
          } : {}),
        },
      },
    )
    updated += result.modifiedCount
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    matchedRecords: count,
    updatedRecords: updated,
    backup: backup ? { file: backup.file, count: backup.count, sha256: backup.sha256 } : null,
  })
  console.log(`[${MIGRATION}] completed updated=${updated} manifest=${manifest}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined)
})
