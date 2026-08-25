import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase5-final-regression-hardening-v1'
const TEMPLATE_IDS = Array.from({ length: 10 }, (_, index) => `template-${index + 1}`)

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const submissions = db.collection('websitesubmissions')
  const metaIntegrations = db.collection('metaintegrations')
  const metaEvents = db.collection('metaevents')
  const invoices = db.collection('financeinvoices')
  const organizations = db.collection('organizations')

  const legacyLeadFilter = {
    linkedEntityType: 'Lead',
    linkedEntityId: { $exists: true, $ne: null },
    $or: [{ crmTransferStatus: { $exists: false } }, { crmTransferStatus: null }],
  }
  const legacyNonLeadFilter = {
    linkedEntityType: { $in: ['Viewing', 'AgencyReview'] },
    $or: [{ crmTransferStatus: { $exists: false } }, { crmTransferStatus: null }],
  }
  const metaLegacyFilter = {
    $or: [
      { pixelEnabled: { $exists: false } },
      { capiEnabled: { $exists: false } },
      { capiStatus: { $exists: false } },
    ],
  }
  const invalidTemplateFilter = {
    templateId: { $exists: true, $nin: TEMPLATE_IDS },
  }

  const [legacyLeadRows, legacyNonLeadRows, legacyMetaRows, invalidTemplateRows] = await Promise.all([
    submissions.countDocuments(legacyLeadFilter),
    submissions.countDocuments(legacyNonLeadFilter),
    metaIntegrations.countDocuments(metaLegacyFilter),
    organizations.countDocuments(invalidTemplateFilter),
  ])

  const indexPlan = [
    ['websitesubmissions', { organizationId: 1, crmTransferStatus: 1, submittedAt: -1 }, { name: 'submission_tenant_crm_transfer_submitted' }],
    ['metaevents', { organizationId: 1, eventId: 1, eventName: 1 }, { name: 'meta_event_tenant_event_unique', unique: true }],
    ['metaevents', { status: 1, nextAttemptAt: 1 }, { name: 'meta_event_queue_next_attempt' }],
    ['financeinvoices', { organizationId: 1, propertyId: 1, createdAt: -1 }, { name: 'finance_invoice_tenant_property_created' }],
  ] as const

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    legacyLeadRows,
    legacyNonLeadRows,
    legacyMetaRows,
    invalidTemplateRows,
    indexes: indexPlan.map(([collection, , options]) => `${collection}.${options.name}`),
  }, null, 2))

  if (invalidTemplateRows > 0) {
    console.warn(`[${MIGRATION}] ${invalidTemplateRows} organization(s) have an unsupported templateId. This migration does not rewrite tenant design choices; resolve those rows before release.`)
  }

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const [leadBackfill, nonLeadBackfill, metaBackfill] = await Promise.all([
    submissions.updateMany(legacyLeadFilter, [
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
    submissions.updateMany(legacyNonLeadFilter, {
      $set: { crmTransferStatus: 'NOT_APPLICABLE', crmTransferStartedAt: null, crmTransferError: '' },
    }),
    metaIntegrations.updateMany(metaLegacyFilter, [
      {
        $set: {
          pixelEnabled: { $ne: ['$status', 'disabled'] },
          capiEnabled: {
            $and: [
              { $ne: ['$status', 'disabled'] },
              { $gt: [{ $strLenCP: { $ifNull: ['$accessTokenEncrypted', ''] } }, 0] },
            ],
          },
          capiStatus: {
            $switch: {
              branches: [
                { case: { $eq: [{ $strLenCP: { $ifNull: ['$accessTokenEncrypted', ''] } }, 0] }, then: 'not_configured' },
                { case: { $eq: ['$status', 'disabled'] }, then: 'disabled' },
                { case: { $eq: ['$status', 'error'] }, then: 'error' },
              ],
              default: 'active',
            },
          },
        },
      },
    ]),
  ])

  const collections: Record<string, any> = { websitesubmissions: submissions, metaevents: metaEvents, financeinvoices: invoices }
  const appliedIndexes: string[] = []
  for (const [collectionName, keys, options] of indexPlan) {
    await collections[collectionName].createIndex(keys as any, options as any)
    appliedIndexes.push(`${collectionName}.${options.name}`)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    legacyLeadRowsMatched: leadBackfill.matchedCount,
    legacyLeadRowsModified: leadBackfill.modifiedCount,
    legacyNonLeadRowsMatched: nonLeadBackfill.matchedCount,
    legacyNonLeadRowsModified: nonLeadBackfill.modifiedCount,
    legacyMetaRowsMatched: metaBackfill.matchedCount,
    legacyMetaRowsModified: metaBackfill.modifiedCount,
    invalidTemplateRows,
    appliedIndexes,
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
