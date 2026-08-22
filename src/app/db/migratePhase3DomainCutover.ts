import mongoose from 'mongoose'
import config from '../../config'
import { DomainRecord } from '../module/domain/domain.model'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase3-domain-cutover'
const CONFIRMATION = 'PHASE3-DOMAIN-CUTOVER'

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

  const collection = DomainRecord.collection
  const filter = {
    $or: [
      { candidate: { $exists: false } },
      { retiredDomains: { $exists: false } },
    ],
  }
  const count = await collection.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} records=${count}`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No records changed. Use --apply --confirm=${CONFIRMATION} after reviewing this plan.`)
    return
  }

  const backup = count
    ? await backupDocuments({ collection, filter, migrationName: MIGRATION, backupDir: cli.backupDir })
    : null

  const result = await collection.updateMany(filter, [
    {
      $set: {
        candidate: { $ifNull: ['$candidate', null] },
        retiredDomains: { $ifNull: ['$retiredDomains', []] },
      },
    },
  ])

  await collection.createIndex(
    { 'candidate.domain': 1 },
    {
      name: 'candidate.domain_1',
      unique: true,
      partialFilterExpression: { 'candidate.domain': { $type: 'string' } },
    },
  )
  await collection.createIndex({ 'retiredDomains.domain': 1 }, { name: 'retiredDomains.domain_1' })
  await collection.createIndex({ 'retiredDomains.retireAfter': 1 }, { name: 'retiredDomains.retireAfter_1' })


  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    matchedRecords: count,
    updatedRecords: result.modifiedCount,
    indexes: ['candidate.domain_1', 'retiredDomains.domain_1', 'retiredDomains.retireAfter_1'],
    backup: backup ? { file: backup.file, count: backup.count, sha256: backup.sha256 } : null,
  })
  console.log(`[${MIGRATION}] completed updated=${result.modifiedCount} manifest=${manifest}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined)
})
