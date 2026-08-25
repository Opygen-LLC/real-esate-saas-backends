import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'website-submissions-inbox-crm-transfer-v2'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const collection = db.collection('websitesubmissions')
  const legacyLeadFilter = {
    linkedEntityType: 'Lead',
    linkedEntityId: { $exists: true, $ne: null },
    $or: [{ crmTransferStatus: { $exists: false } }, { crmTransferStatus: null }],
  }
  const legacyNonLeadFilter = {
    linkedEntityType: { $in: ['Viewing', 'AgencyReview'] },
    $or: [{ crmTransferStatus: { $exists: false } }, { crmTransferStatus: null }],
  }

  const [legacyLeadCount, legacyNonLeadCount] = await Promise.all([
    collection.countDocuments(legacyLeadFilter),
    collection.countDocuments(legacyNonLeadFilter),
  ])

  const indexes = [
    [{ organizationId: 1, submittedAt: -1 }, { name: 'submission_tenant_submitted' }],
    [{ organizationId: 1, status: 1, submittedAt: -1 }, { name: 'submission_tenant_status_submitted' }],
    [{ organizationId: 1, submissionType: 1, submittedAt: -1 }, { name: 'submission_tenant_type_submitted' }],
    [{ organizationId: 1, propertyId: 1, submittedAt: -1 }, { name: 'submission_tenant_property_submitted' }],
    [{ organizationId: 1, linkedEntityType: 1, linkedEntityId: 1, submittedAt: -1 }, { name: 'submission_tenant_linked_entity_submitted' }],
    [{ organizationId: 1, crmTransferStatus: 1, submittedAt: -1 }, { name: 'submission_tenant_crm_transfer_submitted' }],
  ] as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} legacyLeadRows=${legacyLeadCount} legacyNonLeadRows=${legacyNonLeadCount} indexes=${indexes.length}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const [leadBackfill, nonLeadBackfill] = await Promise.all([
    collection.updateMany(legacyLeadFilter, [
      {
        $set: {
          crmTransferStatus: 'COMPLETED',
          crmTransferOutcome: 'LEGACY',
          crmTransferStartedAt: null,
          movedToCrmAt: { $ifNull: ['$processedAt', { $ifNull: ['$submittedAt', '$createdAt'] }] },
          movedToCrmBy: null,
          crmTransferError: '',
        },
      },
    ]),
    collection.updateMany(legacyNonLeadFilter, {
      $set: {
        crmTransferStatus: 'NOT_APPLICABLE',
        crmTransferStartedAt: null,
        crmTransferError: '',
      },
    }),
  ])

  const applied: string[] = []
  for (const [keys, options] of indexes) {
    await collection.createIndex(keys as any, options as any)
    applied.push(options.name)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backfilledLegacyLeadRows: leadBackfill.modifiedCount,
    backfilledNonLeadRows: nonLeadBackfill.modifiedCount,
    appliedIndexes: applied,
  })
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
