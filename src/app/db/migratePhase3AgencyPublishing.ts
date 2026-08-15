import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase3-agency-publishing-legacy-ops-removal'
const CONFIRMATION = 'PHASE3_REMOVE_LEGACY_OPERATIONS'
const LEGACY_PERMISSIONS = new Set(['compliance.read', 'compliance.write'])

const collectionExists = async (db: any, name: string): Promise<boolean> =>
  Boolean(await db.listCollections({ name }, { nameOnly: true }).hasNext())

const normalizedPermissions = (role: string, permissions: unknown, useRoleDefaults: unknown): string[] => {
  const values = Array.isArray(permissions) ? permissions.map(String).filter((value) => !LEGACY_PERMISSIONS.has(value)) : []
  if (role === 'agency_admin' && useRoleDefaults === false && !values.includes('properties.publish')) values.push('properties.publish')
  return Array.from(new Set(values))
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const properties = db.collection('properties')
  const users = db.collection('users')
  const invitations = db.collection('teaminvitations')
  const operationsJobs = db.collection('operationsjobs')
  const platformSettings = db.collection('platformsettings')
  const removableCollections = ['supporttickets', 'fraudreports', 'complianceprofiles', 'datasubjectrequests'] as const

  const moderationFilter = { $or: [
    { moderationStatus: { $exists: true } },
    { moderationReason: { $exists: true } },
    { moderatedBy: { $exists: true } },
    { moderatedAt: { $exists: true } },
  ] }
  const nonApprovedLiveFilter = {
    status: 'Available',
    $or: [{ moderationStatus: { $exists: false } }, { moderationStatus: { $ne: 'approved' } }],
  }
  const affectedPropertyFilter = { $or: [
    { moderationStatus: { $exists: true } },
    { moderationReason: { $exists: true } },
    { moderatedBy: { $exists: true } },
    { moderatedAt: { $exists: true } },
    { status: 'Available', $or: [{ moderationStatus: { $exists: false } }, { moderationStatus: { $ne: 'approved' } }] },
  ] }
  const accessMigrationFilter = { $or: [
    { 'accessControl.permissions': { $in: Array.from(LEGACY_PERMISSIONS) } },
    { userRole: 'agency_admin', 'accessControl.useRoleDefaults': false },
  ] }
  const legacyJobFilter = { type: 'support_email' }

  const collectionCounts: Record<string, number> = {}
  for (const name of removableCollections) {
    collectionCounts[name] = await collectionExists(db, name) ? await db.collection(name).countDocuments({}) : 0
  }
  const [affectedProperties, moderatedProperties, nonApprovedLive, accessUsers, accessInvitations, supportEmailJobs] = await Promise.all([
    properties.countDocuments(affectedPropertyFilter),
    properties.countDocuments(moderationFilter),
    properties.countDocuments(nonApprovedLiveFilter),
    users.countDocuments(accessMigrationFilter),
    invitations.countDocuments(accessMigrationFilter),
    operationsJobs.countDocuments(legacyJobFilter),
  ])

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`[${MIGRATION}] affectedProperties=${affectedProperties} propertiesWithModeration=${moderatedProperties} nonApprovedAvailableToDraft=${nonApprovedLive}`)
  console.log(`[${MIGRATION}] accessUsers=${accessUsers} accessInvitations=${accessInvitations} supportEmailJobs=${supportEmailJobs}`)
  console.log(`[${MIGRATION}] removableCollections=${JSON.stringify(collectionCounts)}`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Apply during a write-disabled maintenance window immediately before deploying Phase 3.`)
    return
  }

  const backups: Array<{ file: string; count: number; sha256: string }> = []
  backups.push(await backupDocuments({ collection: properties, filter: affectedPropertyFilter, migrationName: MIGRATION, backupDir: cli.backupDir }))
  backups.push(await backupDocuments({ collection: users, filter: accessMigrationFilter, migrationName: MIGRATION, backupDir: cli.backupDir, projection: { _id: 1, organizationId: 1, userRole: 1, accessControl: 1 } }))
  backups.push(await backupDocuments({ collection: invitations, filter: accessMigrationFilter, migrationName: MIGRATION, backupDir: cli.backupDir, projection: { _id: 1, organizationId: 1, userRole: 1, accessControl: 1 } }))
  backups.push(await backupDocuments({ collection: operationsJobs, filter: legacyJobFilter, migrationName: MIGRATION, backupDir: cli.backupDir }))
  const legacyCollectionBackups = new Map<string, { file: string; count: number; sha256: string }>()
  for (const name of removableCollections) {
    if (await collectionExists(db, name)) {
      const backup = await backupDocuments({ collection: db.collection(name), filter: {}, migrationName: MIGRATION, backupDir: cli.backupDir })
      backups.push(backup)
      legacyCollectionBackups.set(name, backup)
    }
  }

  if (affectedProperties > 0 && backups[0].count !== affectedProperties) {
    throw new Error(`Property backup count mismatch. expected=${affectedProperties} actual=${backups[0].count}`)
  }
  if (backups[1].count !== accessUsers) throw new Error(`User access backup count mismatch. expected=${accessUsers} actual=${backups[1].count}`)
  if (backups[2].count !== accessInvitations) throw new Error(`Invitation access backup count mismatch. expected=${accessInvitations} actual=${backups[2].count}`)
  if (backups[3].count !== supportEmailJobs) throw new Error(`Operations-job backup count mismatch. expected=${supportEmailJobs} actual=${backups[3].count}`)
  for (const name of removableCollections) {
    const backup = legacyCollectionBackups.get(name)
    if (backup && backup.count !== collectionCounts[name]) {
      throw new Error(`Legacy collection backup count mismatch for ${name}. expected=${collectionCounts[name]} actual=${backup.count}`)
    }
  }

  const draftResult = await properties.updateMany(nonApprovedLiveFilter, { $set: { status: 'Draft', publishedAt: null } })
  const moderationResult = await properties.updateMany(moderationFilter, { $unset: { moderationStatus: '', moderationReason: '', moderatedBy: '', moderatedAt: '' } })
  const indexes = await properties.indexes().catch(() => [] as any[])
  const moderationIndexes = indexes.filter((index: any) => Object.keys(index.key || {}).includes('moderationStatus'))
  for (const index of moderationIndexes) if (index.name) await properties.dropIndex(index.name)

  let usersUpdated = 0
  for await (const user of users.find(accessMigrationFilter, { projection: { userRole: 1, accessControl: 1 } })) {
    const permissions = normalizedPermissions(String(user.userRole || ''), user.accessControl?.permissions, user.accessControl?.useRoleDefaults)
    const result = await users.updateOne({ _id: user._id }, { $set: { 'accessControl.permissions': permissions } })
    usersUpdated += result.modifiedCount
  }

  let invitationsUpdated = 0
  for await (const invitation of invitations.find(accessMigrationFilter, { projection: { userRole: 1, accessControl: 1 } })) {
    const permissions = normalizedPermissions(String(invitation.userRole || ''), invitation.accessControl?.permissions, invitation.accessControl?.useRoleDefaults)
    const result = await invitations.updateOne({ _id: invitation._id }, { $set: { 'accessControl.permissions': permissions } })
    invitationsUpdated += result.modifiedCount
  }

  const jobsDeleted = await operationsJobs.deleteMany(legacyJobFilter)
  const droppedCollections: string[] = []
  for (const name of removableCollections) {
    if (await collectionExists(db, name)) {
      await db.collection(name).drop()
      droppedCollections.push(name)
    }
  }

  const supportDefaults = {
    'support.whatsapp': '+8801891793354',
    'support.phone': '+8801891793354',
    'support.email': '',
    'support.facebook': '',
    'support.messenger': '',
    'support.instagram': '',
    'support.linkedin': '',
    'support.youtube': '',
    'support.website': '',
  }
  const existingSettings: any = await platformSettings.findOne({ key: 'platform' })
  const supportSet: Record<string, string> = {}
  for (const [path, value] of Object.entries(supportDefaults)) {
    const field = path.replace(/^support\./, '')
    if (existingSettings?.support?.[field] === undefined) supportSet[path] = value
  }
  await platformSettings.updateOne(
    { key: 'platform' },
    { $setOnInsert: { key: 'platform' }, ...(Object.keys(supportSet).length ? { $set: supportSet } : {}) },
    { upsert: true },
  )

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backups,
    downgradedAvailableListings: draftResult.modifiedCount,
    moderationFieldsRemoved: moderationResult.modifiedCount,
    moderationIndexesDropped: moderationIndexes.map((index: any) => index.name).filter(Boolean),
    usersUpdated,
    invitationsUpdated,
    supportEmailJobsDeleted: jobsDeleted.deletedCount,
    droppedCollections,
    supportDefaultsInstalled: Object.keys(supportSet),
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
