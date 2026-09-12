import mongoose from 'mongoose'
import config from '../../config'
import { DomainRecord } from '../module/domain/domain.model'
import { DomainService } from '../module/domain/domain.service'
import { backupDocuments, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase4-vercel-cloudflare-domains'
const CONFIRMATION = 'PHASE4-VERCEL-CLOUDFLARE'
const command = String(process.argv[2] || 'plan').trim().toLowerCase()
const apply = process.argv.includes('--apply')
const getArg = (name: string) => {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || ''
}
const organizationId = getArg('organization') || getArg('organizationId')
const limit = Math.max(1, Math.min(500, Number(getArg('limit') || 25)))
const backupDir = getArg('backup-dir') || undefined
const confirmed = getArg('confirm') === CONFIRMATION
const allowLegacyRemoval = /^(1|true|yes|on)$/i.test(process.env.CLOUDFLARE_PHASE4_ALLOW_VERCEL_REMOVAL || '')
const allowRollback = /^(1|true|yes|on)$/i.test(process.env.CLOUDFLARE_PHASE4_ALLOW_ROLLBACK || '')

const eligibleFilter = {
  $and: [
    { $or: [{ provider: 'vercel' }, { provider: { $exists: false } }] },
    { entitlementStatus: { $ne: 'suspended' } },
    { lifecycleStatus: 'ACTIVE' },
    { status: 'verified' },
    { tlsStatus: 'active' },
    { publicRoutingStatus: 'active' },
    { $or: [{ candidate: null }, { candidate: { $exists: false } }] },
    { $or: [{ providerMigration: null }, { providerMigration: { $exists: false } }, { 'providerMigration.migrationStatus': 'NOT_STARTED' }] },
  ],
}

const scope = <T extends Record<string, unknown>>(filter: T): T & Record<string, unknown> => (
  organizationId ? { ...filter, organizationId } : filter
)

const requireApply = () => {
  if (!apply || !confirmed) {
    throw new Error(`This command changes production state. Re-run with --apply --confirm=${CONFIRMATION}`)
  }
}

const summarize = async () => {
  const now = new Date()
  const [eligible, registered, waitingDns, tlsActive, trafficSwitched, removable, removed] = await Promise.all([
    DomainRecord.countDocuments(scope(eligibleFilter)),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'CF_REGISTERED' })),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'WAITING_DNS' })),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'CF_TLS_ACTIVE' })),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'TRAFFIC_SWITCHED' })),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'TRAFFIC_SWITCHED', 'providerMigration.rollbackUntil': { $lte: now } })),
    DomainRecord.countDocuments(scope({ 'providerMigration.migrationStatus': 'VERCEL_REMOVED' })),
  ])
  return { eligible, registered, waitingDns, tlsActive, trafficSwitched, removable, removed, scope: organizationId || 'all', limit }
}

const backup = async (filter: Record<string, unknown>) => {
  const count = await DomainRecord.collection.countDocuments(filter)
  if (!count) return null
  return backupDocuments({ collection: DomainRecord.collection, filter, migrationName: MIGRATION, backupDir })
}

async function main() {
  if (!['plan', 'start', 'advance', 'finalize', 'rollback'].includes(command)) {
    throw new Error('Usage: <plan|start|advance|finalize|rollback> [--organization=<organizationId>] [--limit=25] [--apply --confirm=PHASE4-VERCEL-CLOUDFLARE]')
  }
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  if (command === 'plan') {
    console.log(JSON.stringify({ migration: MIGRATION, mode: 'READ_ONLY', ...(await summarize()) }, null, 2))
    console.log('No database or provider state was changed.')
    return
  }

  requireApply()
  let filter: Record<string, unknown>
  if (command === 'start') filter = scope(eligibleFilter)
  else if (command === 'advance') filter = scope({ 'providerMigration.migrationStatus': { $in: ['CF_REGISTERED', 'WAITING_DNS', 'CF_TLS_ACTIVE'] } })
  else if (command === 'finalize') filter = scope({ 'providerMigration.migrationStatus': 'TRAFFIC_SWITCHED', 'providerMigration.rollbackUntil': { $lte: new Date() } })
  else {
    if (!organizationId) throw new Error('Rollback requires --organization=<organizationId>; bulk rollback is intentionally disabled')
    filter = scope({ 'providerMigration.migrationStatus': { $in: ['CF_REGISTERED', 'WAITING_DNS', 'CF_TLS_ACTIVE', 'TRAFFIC_SWITCHED'] } })
  }

  if (command === 'finalize' && !allowLegacyRemoval) {
    throw new Error('Vercel removal is blocked. Set CLOUDFLARE_PHASE4_ALLOW_VERCEL_REMOVAL=true only after the rollback grace window and traffic verification.')
  }
  if (command === 'rollback' && !allowRollback) {
    throw new Error('Rollback is blocked. Set CLOUDFLARE_PHASE4_ALLOW_ROLLBACK=true after restoring the customer DNS to the rollback records shown by Opygen.')
  }

  const before = await backup(filter)
  const records = await DomainRecord.find(filter).sort({ updatedAt: 1 }).limit(command === 'rollback' ? 1 : limit)
  const results: Array<{ organizationId: string; domain: string; status: string; ok: boolean; error?: string }> = []

  for (const record of records) {
    try {
      let data: any
      if (command === 'start') data = await DomainService.startProviderMigrationByOrganization(record.organizationId)
      else if (command === 'advance') data = await DomainService.advanceProviderMigrationByOrganization(record.organizationId)
      else if (command === 'finalize') data = await DomainService.finalizeProviderMigrationByOrganization(record.organizationId)
      else data = await DomainService.rollbackProviderMigrationByOrganization(record.organizationId)
      results.push({ organizationId: record.organizationId, domain: record.domain, status: data?.providerMigration?.migrationStatus || (command === 'rollback' ? 'ROLLED_BACK' : 'UNKNOWN'), ok: true })
    } catch (error) {
      results.push({ organizationId: record.organizationId, domain: record.domain, status: record.providerMigration?.migrationStatus || 'UNKNOWN', ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const manifest = await writeMigrationManifest(backupDir, MIGRATION, {
    command,
    scope: organizationId || 'all',
    processed: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    backup: before ? { file: before.file, count: before.count, sha256: before.sha256 } : null,
    results,
    after: await summarize(),
  })
  console.log(JSON.stringify({ command, results, manifest }, null, 2))
  if (results.some((item) => !item.ok)) process.exitCode = 2
}

main().catch((error) => {
  console.error(`[${MIGRATION}] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined)
})
