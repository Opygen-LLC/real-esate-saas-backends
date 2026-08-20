import mongoose from 'mongoose'
import config from '../../config'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import {
  publishResourceEntitlementReconciliation,
  reconcileResourceEntitlements,
} from '../module/entitlement/resourceEntitlementReconciliation.service'
import { resolveSubscriptionEntitlementSnapshot } from '../module/entitlement/subscriptionEntitlementReconciliation.service'
import { Organization } from '../module/organization/organization.model'

const MIGRATION = 'phase8-resource-entitlements'
const ACTOR = 'system:phase8-resource-entitlements'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const organizations = await Organization.find({ 'subscription.plan': { $exists: true } })
    .select('organizationId subscription')
    .sort({ organizationId: 1 })
    .lean()
  const organizationIds = organizations.map((org: any) => String(org.organizationId)).filter(Boolean)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} organizations=${organizationIds.length}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No documents changed. Use --apply after reviewing the organization count.`)
    return
  }

  if (!await mongoSupportsTransactions()) {
    throw new Error('Phase 8 reconciliation requires a MongoDB replica set or mongos so each tenant is reconciled atomically')
  }

  const filter = { organizationId: { $in: organizationIds } }
  const backups = []
  for (const [collectionName, projection] of [
    ['organizations', { organizationId: 1, subscription: 1, domain_Verify: 1, entitlementRestrictions: 1, propertyQuotaRevision: 1 }],
    ['properties', { organizationId: 1, status: 1, quotaLocked: 1, quotaLockedReason: 1, quotaLockedAt: 1, quotaLockedBy: 1, createdAt: 1 }],
    ['domainrecords', { organizationId: 1, domain: 1, status: 1, tlsStatus: 1, entitlementStatus: 1, entitlementSuspendedAt: 1, entitlementSuspendedReason: 1 }],
    ['whatsappintegrations', { organizationId: 1, status: 1, entitlementStatus: 1, entitlementSuspendedAt: 1 }],
    ['crmconfigs', { organizationId: 1, entitlementExecutionBlocked: 1 }],
    ['operationsjobs', { organizationId: 1, type: 1, status: 1, lockedAt: 1, lockedBy: 1, lastError: 1 }],
  ] as const) {
    const collection = db.collection(collectionName)
    backups.push(await backupDocuments({
      collection,
      filter: collectionName === 'operationsjobs'
        ? { ...filter, type: 'sms_send', status: { $in: ['pending', 'processing'] } }
        : filter,
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
      projection,
    }))
  }

  let reconciled = 0
  let failed = 0
  const failures: Array<{ organizationId: string; error: string }> = []

  for (const organizationId of organizationIds) {
    const session = await mongoose.startSession()
    let result: Awaited<ReturnType<typeof reconcileResourceEntitlements>> | null = null
    try {
      await session.withTransaction(async () => {
        const current: any = await Organization.findOne({ organizationId }).select('subscription').session(session).lean()
        if (!current?.subscription?.plan) throw new Error('Organization does not have an effective subscription plan')
        const lock = await Organization.updateOne(
          { organizationId },
          { $inc: { teamQuotaRevision: 1, propertyQuotaRevision: 1 } },
          { session },
        )
        if (!lock.matchedCount) throw new Error('Organization disappeared during reconciliation')
        const snapshot = await resolveSubscriptionEntitlementSnapshot(current.subscription, session)
        result = await reconcileResourceEntitlements(organizationId, snapshot, snapshot, {
          session,
          actorId: ACTOR,
          reason: 'One-time Phase 8 resource entitlement reconciliation',
        })
      })
      await publishResourceEntitlementReconciliation(result)
      reconciled += 1
    } catch (error) {
      failed += 1
      failures.push({ organizationId, error: error instanceof Error ? error.message : String(error) })
    } finally {
      await session.endSession()
    }
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    organizations: organizationIds.length,
    reconciled,
    failed,
    failures,
    backups,
  })
  console.log(`[${MIGRATION}] completed reconciled=${reconciled} failed=${failed} manifest=${manifest}`)
  if (failed) process.exitCode = 2
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
