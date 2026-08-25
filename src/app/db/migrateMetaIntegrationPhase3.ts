import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'meta-integration-browser-capi-separation-v1'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const collection = db.collection('metaintegrations')
  const filter = { $or: [{ pixelEnabled: { $exists: false } }, { capiEnabled: { $exists: false } }, { capiStatus: { $exists: false } }] }
  const count = await collection.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} legacyRows=${count}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Use --apply after reviewing this plan.`)
    return
  }

  const result = await collection.updateMany(filter, [
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
  ])

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { matchedRows: result.matchedCount, modifiedRows: result.modifiedCount })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
