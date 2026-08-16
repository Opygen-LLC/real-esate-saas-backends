import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { normalizePostalCode } from '../module/property/property.normalization'

const MIGRATION = 'phase2-property-correctness'
const CONFIRM = 'APPLY_PROPERTY_CORRECTNESS'

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRM)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const properties = db.collection('properties')
  const filter = {
    $or: [
      { zipCode: { $exists: true } },
      { 'bangladeshAddress.postalCode': { $exists: true } },
    ],
  } as never

  const affected = await properties.countDocuments(filter)
  let invalid = 0
  let conflicts = 0
  let canonicalized = 0

  const previewCursor = properties.find(filter, { projection: { zipCode: 1, 'bangladeshAddress.postalCode': 1 } })
  for await (const property of previewCursor) {
    const legacy = normalizePostalCode((property as any).zipCode)
    const nested = normalizePostalCode((property as any).bangladeshAddress?.postalCode)
    if (legacy && !/^\d{4}$/.test(legacy)) invalid += 1
    if (nested && !/^\d{4}$/.test(nested)) invalid += 1
    if (legacy && nested && legacy !== nested) conflicts += 1
    if ((nested && /^\d{4}$/.test(nested)) || (legacy && /^\d{4}$/.test(legacy))) canonicalized += 1
  }

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} affected=${affected} canonicalizable=${canonicalized} conflicts=${conflicts} invalid=${invalid}`)
  if (invalid > 0) {
    throw new Error(`[${MIGRATION}] ${invalid} invalid postal code value(s) found. Fix them before applying this migration.`)
  }
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply --confirm=${CONFIRM} after reviewing the counts.`)
    return
  }

  const backup = await backupDocuments({ collection: properties, filter, migrationName: MIGRATION, backupDir: cli.backupDir })
  if (backup.count !== affected) throw new Error(`Backup validation failed: expected ${affected} documents, backed up ${backup.count}`)

  let changed = 0
  const cursor = properties.find(filter)
  for await (const property of cursor) {
    const legacy = normalizePostalCode((property as any).zipCode)
    const nested = normalizePostalCode((property as any).bangladeshAddress?.postalCode)
    const canonical = nested || legacy
    const update: any = { $unset: { zipCode: '' } }
    if (canonical) update.$set = { 'bangladeshAddress.postalCode': canonical }
    await properties.updateOne({ _id: property._id }, update)
    changed += 1
  }

  const legacyRemaining = await properties.countDocuments({ zipCode: { $exists: true } })
  const invalidCanonical = await properties.countDocuments({
    'bangladeshAddress.postalCode': { $exists: true, $nin: ['', null], $not: /^\d{4}$/ },
  } as never)

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    changed,
    conflictsResolvedInFavorOfExistingCanonicalField: conflicts,
    verification: { legacyZipCodeFieldsRemaining: legacyRemaining, invalidCanonicalPostalCodes: invalidCanonical },
  })

  if (legacyRemaining || invalidCanonical) {
    throw new Error(`Post-migration verification failed. manifest=${manifest}`)
  }
  console.log(`[${MIGRATION}] completed changed=${changed} backup=${backup.file} manifest=${manifest}`)
}

run()
  .catch(error => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
