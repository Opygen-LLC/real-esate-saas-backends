import mongoose from 'mongoose'
import config from '../../config'
import { DomainRecord } from '../module/domain/domain.model'

const command = String(process.argv[2] || 'plan').trim().toLowerCase()
const now = new Date()

const pendingMigrationStatuses = ['CF_REGISTERED', 'WAITING_DNS', 'CF_TLS_ACTIVE', 'TRAFFIC_SWITCHED']

const summarize = async () => {
  const [
    legacyServing,
    pendingMigrations,
    rollbackWindowsOpen,
    vercelCandidates,
    vercelRetiredPendingRemoval,
    cloudflareActive,
    finalizedMigrations,
  ] = await Promise.all([
    DomainRecord.countDocuments({
      $and: [
        { $or: [{ provider: 'vercel' }, { provider: { $exists: false } }, { provider: '' }] },
        { $or: [
          { lifecycleStatus: 'ACTIVE' },
          { status: 'verified' },
          { providerRegistrationStatus: 'registered' },
        ] },
      ],
    }),
    DomainRecord.countDocuments({ 'providerMigration.migrationStatus': { $in: pendingMigrationStatuses } }),
    DomainRecord.countDocuments({
      'providerMigration.migrationStatus': 'TRAFFIC_SWITCHED',
      'providerMigration.rollbackUntil': { $gt: now },
    }),
    DomainRecord.countDocuments({ 'candidate.provider': 'vercel' }),
    DomainRecord.countDocuments({
      retiredDomains: {
        $elemMatch: {
          provider: 'vercel',
          $or: [{ providerRemovedAt: null }, { providerRemovedAt: { $exists: false } }],
        },
      },
    }),
    DomainRecord.countDocuments({
      provider: 'cloudflare',
      lifecycleStatus: 'ACTIVE',
      status: 'verified',
      tlsStatus: 'active',
      publicRoutingStatus: 'active',
    }),
    DomainRecord.countDocuments({ 'providerMigration.migrationStatus': 'VERCEL_REMOVED' }),
  ])

  const blockers = {
    legacyServing,
    pendingMigrations,
    rollbackWindowsOpen,
    vercelCandidates,
    vercelRetiredPendingRemoval,
  }
  const ready = Object.values(blockers).every((value) => value === 0)
  return {
    checkedAt: now.toISOString(),
    ready,
    blockers,
    cloudflare: { active: cloudflareActive, finalizedMigrations },
  }
}

const main = async () => {
  if (!['plan', 'assert-retirement-ready'].includes(command)) {
    throw new Error('Usage: ts-node --transpile-only src/app/db/verifyCloudflarePhase5Retirement.ts <plan|assert-retirement-ready>')
  }
  await mongoose.connect(config.database_string as string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  try {
    const report = await summarize()
    console.log(JSON.stringify(report, null, 2))
    if (command === 'assert-retirement-ready' && !report.ready) {
      throw new Error(`Vercel retirement is blocked: ${JSON.stringify(report.blockers)}`)
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((error) => {
  console.error(`[cloudflare-phase5-retirement] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
