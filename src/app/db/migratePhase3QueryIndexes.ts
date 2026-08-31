import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase3-query-indexes-v1'
const CONFIRMATION = 'phase3-query-indexes'

type IndexSpec = {
  collection: string
  name: string
  keys: Record<string, 1 | -1>
}

const INDEXES: IndexSpec[] = [
  { collection: 'properties', name: 'property_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
  { collection: 'tasks', name: 'task_tenant_dueat_cursor', keys: { organizationId: 1, dueAt: 1, _id: 1 } },
  { collection: 'leads', name: 'lead_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
]

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

  const status = [] as Array<IndexSpec & { exists: boolean }>
  for (const spec of INDEXES) {
    const indexes = await db.collection(spec.collection).listIndexes().toArray().catch((error: any) => {
      if (error?.codeName === 'NamespaceNotFound') return []
      throw error
    })
    status.push({ ...spec, exists: indexes.some((index) => index.name === spec.name) })
  }

  const missing = status.filter((item) => !item.exists)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} missing=${missing.length}`)
  console.table(status.map(({ collection, name, exists }) => ({ collection, name, exists })))

  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'dry-run', status })
    console.log(`[${MIGRATION}] manifest=${manifest}; no indexes changed.`)
    console.log(`[${MIGRATION}] apply after query-plan review with --apply --confirm=${CONFIRMATION}`)
    return
  }

  const created: string[] = []
  for (const spec of missing) {
    await db.collection(spec.collection).createIndex(spec.keys, { name: spec.name, background: true })
    created.push(`${spec.collection}.${spec.name}`)
  }
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'apply', status, created })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
