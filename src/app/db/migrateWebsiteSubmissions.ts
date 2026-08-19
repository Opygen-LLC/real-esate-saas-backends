import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'website-submissions-inbox'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const indexes = [
    [{ organizationId: 1, submittedAt: -1 }, { name: 'submission_tenant_submitted' }],
    [{ organizationId: 1, status: 1, submittedAt: -1 }, { name: 'submission_tenant_status_submitted' }],
    [{ organizationId: 1, submissionType: 1, submittedAt: -1 }, { name: 'submission_tenant_type_submitted' }],
    [{ organizationId: 1, propertyId: 1, submittedAt: -1 }, { name: 'submission_tenant_property_submitted' }],
    [{ organizationId: 1, linkedEntityType: 1, linkedEntityId: 1, submittedAt: -1 }, { name: 'submission_tenant_linked_entity_submitted' }],
  ] as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=${indexes.length}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const collection = db.collection('websitesubmissions')
  const applied: string[] = []
  for (const [keys, options] of indexes) {
    await collection.createIndex(keys as any, options as any)
    applied.push(options.name)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { appliedIndexes: applied })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
