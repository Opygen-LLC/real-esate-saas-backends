import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'tenant-relation-integrity-phase1-v1'
const CONFIRMATION = 'tenant-relations-phase1'
const id = (value: unknown) => String(value || '')

type RepairMode = 'unset' | 'hard_blocker'
type Finding = {
  collection: 'tasks' | 'viewings'
  documentId: string
  organizationId: string
  field: string
  referenceId: string
  issue: string
  repair: RepairMode
}

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

  const tasks = db.collection('tasks')
  const viewings = db.collection('viewings')
  const properties = db.collection('properties')
  const leads = db.collection('leads')
  const users = db.collection('users')
  const findings: Finding[] = []

  const [propertyRows, leadRows, userRows] = await Promise.all([
    properties.find({}, { projection: { _id: 1, organizationId: 1 } }).toArray(),
    leads.find({}, { projection: { _id: 1, organizationId: 1 } }).toArray(),
    users.find({}, { projection: { _id: 1, organizationId: 1 } }).toArray(),
  ])
  const tenantByProperty = new Map<string, string>(propertyRows.map((row: { _id: unknown; organizationId?: unknown }) => [id(row._id), id(row.organizationId)]))
  const tenantByLead = new Map<string, string>(leadRows.map((row: { _id: unknown; organizationId?: unknown }) => [id(row._id), id(row.organizationId)]))
  const tenantByUser = new Map<string, string>(userRows.map((row: { _id: unknown; organizationId?: unknown }) => [id(row._id), id(row.organizationId)]))

  const check = (
    row: Record<string, unknown>,
    collection: Finding['collection'],
    field: string,
    map: Map<string, string>,
    repair: RepairMode,
  ) => {
    const ref = id(row[field])
    if (!ref) return
    const owner = map.get(ref)
    if (owner === id(row.organizationId)) return
    findings.push({
      collection,
      documentId: id(row._id),
      organizationId: id(row.organizationId),
      field,
      referenceId: ref,
      issue: owner ? `reference belongs to tenant ${owner}` : 'reference target does not exist',
      repair,
    })
  }

  for await (const task of tasks.find({}, { projection: { organizationId: 1, taskType: 1, linkedLead: 1, linkedProperty: 1, assignedAgent: 1 } })) {
    const followUp = task.taskType === 'lead_follow_up'
    check(task, 'tasks', 'linkedLead', tenantByLead, followUp ? 'hard_blocker' : 'unset')
    check(task, 'tasks', 'linkedProperty', tenantByProperty, 'unset')
    check(task, 'tasks', 'assignedAgent', tenantByUser, followUp ? 'hard_blocker' : 'unset')
  }
  for await (const viewing of viewings.find({}, { projection: { organizationId: 1, leadId: 1, propertyId: 1, agentId: 1 } })) {
    check(viewing, 'viewings', 'leadId', tenantByLead, 'unset')
    check(viewing, 'viewings', 'propertyId', tenantByProperty, 'hard_blocker')
    check(viewing, 'viewings', 'agentId', tenantByUser, 'hard_blocker')
  }

  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    const key = `${finding.collection}.${finding.field}`
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
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
      collection: tasks,
      filter: { _id: { $in: taskIds.map(toObjectId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
  }
  if (viewingIds.length) {
    backups.push(await backupDocuments({
      collection: viewings,
      filter: { _id: { $in: viewingIds.map(toObjectId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }))
  }

  let repaired = 0
  for (const finding of repairable) {
    const collection = db.collection(finding.collection)
    const result = await collection.updateOne(
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
