import crypto from 'node:crypto'
import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'tenant-access-phase5'
const PLATFORM_STATUSES = new Set(['active', 'suspended', 'archived', 'pending_deletion'])
const WEBSITE_STATUSES = new Set(['provisioned', 'published', 'suspended'])
const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended'])

const subscriptionFingerprint = async (organizations: any) => {
  const hash = crypto.createHash('sha256')
  let count = 0
  const cursor = organizations.find({}).sort({ _id: 1 }).project({
    _id: 1,
    organizationId: 1,
    subscription: 1,
  })
  for await (const row of cursor) {
    hash.update(`${JSON.stringify({ _id: row._id, organizationId: row.organizationId, subscription: row.subscription || null })}\n`)
    count += 1
  }
  return { count, sha256: hash.digest('hex') }
}

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const organizations = db.collection('organizations')

  const rows = await organizations.find({}).project({
    _id: 1,
    organizationId: 1,
    isBlocked: 1,
    platformAccess: 1,
    websiteStatus: 1,
    subscription: 1,
  }).toArray()

  const blockers: string[] = []
  const changes: Array<{ _id: unknown; organizationId: string; set: Record<string, unknown> }> = []

  for (const row of rows) {
    const organizationId = String(row.organizationId || row._id)
    const subscriptionStatus = String(row.subscription?.status || '')
    if (!SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
      blockers.push(`${organizationId}: unknown subscription.status=${subscriptionStatus || '<missing>'}; resolve manually so access cannot be guessed`)
    }
    if (!String(row.subscription?.plan || '').trim()) {
      blockers.push(`${organizationId}: subscription.plan is missing; Phase 5 will not assign or guess a plan`)
    }
    const planVersion = Number(row.subscription?.planVersion)
    if (!Number.isFinite(planVersion) || planVersion < 1) {
      blockers.push(`${organizationId}: subscription.planVersion is invalid; Phase 5 will not rewrite plan assignments`)
    }

    const set: Record<string, unknown> = {}
    const rawPlatformStatus = String(row.platformAccess?.status || '')
    if (!PLATFORM_STATUSES.has(rawPlatformStatus)) {
      set['platformAccess.status'] = row.isBlocked === true ? 'suspended' : 'active'
    }

    const rawWebsiteStatus = String(row.websiteStatus || '')
    if (!WEBSITE_STATUSES.has(rawWebsiteStatus)) {
      // Never infer "published" from a missing field. Missing legacy publication
      // state is backfilled fail-closed to provisioned; operators can publish it
      // explicitly after verification without touching subscription state.
      set.websiteStatus = 'provisioned'
    }

    if (Object.keys(set).length) changes.push({ _id: row._id, organizationId, set })
  }

  const beforeFingerprint = await subscriptionFingerprint(organizations)
  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    organizations: rows.length,
    structuralRowsToBackfill: changes.length,
    blockers,
    subscriptionAssignmentMutation: false,
    subscriptionStatusMutation: false,
    subscriptionDateMutation: false,
    dataDeletion: false,
    fieldsEligibleForBackfill: ['platformAccess.status', 'websiteStatus'],
    subscriptionFingerprint: beforeFingerprint,
  }, null, 2))

  if (blockers.length) {
    throw new Error(`Refusing tenant-access Phase 5 migration because ${blockers.length} subscription-state blocker(s) require manual review:\n- ${blockers.join('\n- ')}`)
  }
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  const changedIds = changes.map((row) => row._id)
  const backup = changedIds.length
    ? await backupDocuments({
      collection: organizations,
      filter: { _id: { $in: changedIds } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    })
    : null

  let modified = 0
  for (const row of changes) {
    const result = await organizations.updateOne({ _id: row._id }, { $set: row.set })
    modified += result.modifiedCount
  }

  const afterFingerprint = await subscriptionFingerprint(organizations)
  if (beforeFingerprint.count !== afterFingerprint.count || beforeFingerprint.sha256 !== afterFingerprint.sha256) {
    throw new Error('Subscription fingerprint changed during structural tenant-access migration; stop deployment and restore from the generated backup')
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    organizationsScanned: rows.length,
    structuralRowsModified: modified,
    fieldsBackfilled: ['platformAccess.status', 'websiteStatus'],
    subscriptionFingerprintBefore: beforeFingerprint,
    subscriptionFingerprintAfter: afterFingerprint,
    subscriptionAssignmentMutation: false,
    subscriptionStatusMutation: false,
    subscriptionDateMutation: false,
    dataDeletion: false,
  })

  console.log(`[${MIGRATION}] completed structuralRowsModified=${modified} subscriptionFingerprintPreserved=true manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
