import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'access-restriction-provenance'
const VALID_SOURCES = ['subscription_quota', 'tenant_admin', 'platform_admin']

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const users = db.collection('users')
  const legacyBlockedFilter = {
    status: 'blocked',
    'accessRestriction.source': { $nin: VALID_SOURCES },
  }
  const affected = await users.countDocuments(legacyBlockedFilter)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} legacyBlocked=${affected}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No documents changed. Use --apply after reviewing this plan.`)
    return
  }

  const backup = affected > 0
    ? await backupDocuments({
      collection: users,
      filter: legacyBlockedFilter,
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
      projection: {
        organizationId: 1,
        userRole: 1,
        status: 1,
        accessRestriction: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    })
    : null

  const result = affected > 0
    ? await users.updateMany(legacyBlockedFilter, [
      {
        $set: {
          accessRestriction: {
            source: 'platform_admin',
            reason: {
              $let: {
                vars: {
                  existingReason: {
                    $convert: { input: '$accessRestriction.reason', to: 'string', onError: '', onNull: '' },
                  },
                },
                in: {
                  $cond: [
                    { $gt: [{ $strLenCP: '$$existingReason' }, 0] },
                    '$$existingReason',
                    'Legacy blocked account migrated as platform-controlled restriction',
                  ],
                },
              },
            },
            blockedAt: {
              $ifNull: [
                '$accessRestriction.blockedAt',
                { $ifNull: ['$updatedAt', { $ifNull: ['$createdAt', '$$NOW'] }] },
              ],
            },
            blockedBy: {
              $let: {
                vars: { existingBlockedBy: { $convert: { input: '$accessRestriction.blockedBy', to: 'string', onError: '', onNull: '' } } },
                in: { $cond: [{ $gt: [{ $strLenCP: '$$existingBlockedBy' }, 0] }, '$$existingBlockedBy', 'system:migrate-access-restrictions'] },
              },
            },
            previousStatus: {
              $cond: [{ $eq: ['$accessRestriction.previousStatus', 'pending'] }, 'pending', 'active'],
            },
          },
        },
      },
    ])
    : { matchedCount: 0, modifiedCount: 0 }

  const restrictionIndex = await users.createIndex(
    { organizationId: 1, 'accessRestriction.source': 1, status: 1 },
    { name: 'user_tenant_access_restriction' },
  )

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    affected,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    restrictionIndex,
    legacyPolicy: 'missing_or_unknown_block_source=>platform_admin',
    backup,
  })
  console.log(`[${MIGRATION}] completed modified=${result.modifiedCount} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
