import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { collectTenantRelationFindings, summarizeTenantRelationFindings } from './tenantRelationIntegrity'

const MIGRATION = 'tenant-relation-integrity-phase1-v3'
const CONFIRMATION = 'tenant-relations-phase1'

const toObjectId = (value: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(value)) throw new Error(`Invalid ObjectId in integrity finding: ${value}`)
  return new Types.ObjectId(value)
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const findings = await collectTenantRelationFindings(db)
  const counts = summarizeTenantRelationFindings(findings)
  const hardBlockers = findings.filter((item) => item.repair === 'hard_blocker')

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} findings=${findings.length}`)
  console.table(counts)
  for (const finding of findings.slice(0, 100)) console.log(JSON.stringify(finding))
  if (findings.length > 100) console.log(`[${MIGRATION}] ${findings.length - 100} additional findings omitted from console output`)

  const baseManifest = { mode: cli.apply ? 'apply' : 'dry-run', counts, hardBlockers, findings }
  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { ...baseManifest, repaired: 0 })
    console.log(`[${MIGRATION}] manifest=${manifest}; no data changed. Apply only after reviewing all findings.`)
    return
  }

  // Required relations are never auto-repaired. Abort before backups/mutations so an
  // operator can explicitly reassign/delete those records and then rerun this audit.
  if (hardBlockers.length) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { ...baseManifest, repaired: 0, refusedApply: true })
    throw new Error(`Refusing apply: ${hardBlockers.length} required relationship blocker(s) remain. See ${manifest}`)
  }

  const repairable = findings.filter((item) => item.repair === 'unset')
  const taskIds = [...new Set(repairable.filter((item) => item.collection === 'tasks').map((item) => item.documentId))]
  const viewingIds = [...new Set(repairable.filter((item) => item.collection === 'viewings').map((item) => item.documentId))]
  const backups = [] as Array<{ file: string; count: number; sha256: string }>
  if (taskIds.length) {
    backups.push(await backupDocuments({
      collection: db.collection('tasks'),
      filter: { _id: { $in: taskIds.map(toObjectId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
  }
  if (viewingIds.length) {
    backups.push(await backupDocuments({
      collection: db.collection('viewings'),
      filter: { _id: { $in: viewingIds.map(toObjectId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
  }

  let repaired = 0
  for (const finding of repairable) {
    const result = await db.collection(finding.collection).updateOne(
      {
        _id: toObjectId(finding.documentId),
        organizationId: finding.organizationId,
        [finding.field]: toObjectId(finding.referenceId),
      },
      { $unset: { [finding.field]: '' } },
    )
    repaired += result.modifiedCount
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { ...baseManifest, repaired, backups })
  console.log(`[${MIGRATION}] completed manifest=${manifest} repaired=${repaired}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
