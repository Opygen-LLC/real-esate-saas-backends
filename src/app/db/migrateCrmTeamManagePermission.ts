import mongoose from 'mongoose'
import config from '../../config'

const apply = process.env.MIGRATION_APPLY === 'true'
const TEAM_MANAGE_PERMISSION = 'crm.team.manage'

// These permissions represented the old UI's practical "all CRM access" before
// crm.team.manage existed. Only custom-access records that already had the full
// legacy CRM set are upgraded; narrower custom policies are left unchanged.
const LEGACY_FULL_CRM_PERMISSIONS = [
  'leads.read',
  'leads.write',
  'leads.assign',
  'crm.team.read',
  'contacts.read',
  'contacts.write',
  'tasks.read',
  'tasks.write',
  'viewings.read',
  'viewings.write',
] as const

const collectionExists = async (db: any, name: string): Promise<boolean> =>
  Boolean(await db.listCollections({ name }, { nameOnly: true }).hasNext())

const eligibleFilter = {
  'accessControl.useRoleDefaults': false,
  'accessControl.permissions': {
    $all: [...LEGACY_FULL_CRM_PERMISSIONS],
    $ne: TEAM_MANAGE_PERMISSION,
  },
}

const migrateCollection = async (db: any, name: string) => {
  if (!(await collectionExists(db, name))) return { name, matched: 0, modified: 0 }
  const collection = db.collection(name)
  const matched = await collection.countDocuments(eligibleFilter)
  if (!apply || matched === 0) return { name, matched, modified: 0 }

  const result = await collection.updateMany(
    eligibleFilter,
    { $addToSet: { 'accessControl.permissions': TEAM_MANAGE_PERMISSION } },
  )
  return { name, matched, modified: result.modifiedCount }
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })

  try {
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB connection is not available')

    // userprofiles is canonical after the auth/profile split. users is included
    // for pre-migration/legacy deployments, and pending invitations must preserve
    // the same access policy when accepted after this release.
    const results = []
    for (const name of ['userprofiles', 'teaminvitations', 'users']) {
      results.push(await migrateCollection(db, name))
    }

    console.log(`[crm-team-manage-permission] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
    for (const result of results) {
      console.log(`[crm-team-manage-permission] ${result.name}: eligible=${result.matched} modified=${result.modified}`)
    }
    if (!apply) {
      console.log('[crm-team-manage-permission] No data changed. Re-run with MIGRATION_APPLY=true to apply the idempotent backfill.')
    }
  } finally {
    await mongoose.disconnect()
  }
}

run().catch((error) => {
  console.error('[crm-team-manage-permission] failed', error)
  process.exitCode = 1
})
