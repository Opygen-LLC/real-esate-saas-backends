import mongoose from 'mongoose'
import config from '../../config'
import { AgencyOwnerProfile } from '../module/agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../module/agentProfile/agentProfile.model'
import { User } from '../module/user/user.model'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase8-licensed-broker-visibility'
const LICENSE_PRESENT = /\S/
const AUTO_ENABLE_AGENT_ROLES = ['agency_admin', 'agent'] as const

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const autoEnableAgentUserIds = await User.find({ userRole: { $in: AUTO_ENABLE_AGENT_ROLES } }).distinct('_id')
  const [ownerProfiles, ownerWithLicense, agentProfiles, agentsToEnable] = await Promise.all([
    AgencyOwnerProfile.countDocuments({}),
    AgencyOwnerProfile.countDocuments({ licenseNumber: LICENSE_PRESENT }),
    AgentProfile.countDocuments({}),
    AgentProfile.countDocuments({ userId: { $in: autoEnableAgentUserIds }, licenseNumber: LICENSE_PRESENT }),
  ])

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`[${MIGRATION}] ownerProfiles=${ownerProfiles} ownerWithLicense=${ownerWithLicense}`)
  console.log(`[${MIGRATION}] agentProfiles=${agentProfiles} agencyAdminOrAgentWithLicense=${agentsToEnable}`)
  console.log(`[${MIGRATION}] staff/viewer and missing-license profiles will remain disabled by default`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const [ownerReset, agentReset] = await Promise.all([
    AgencyOwnerProfile.updateMany({}, { $set: { showAsLicensedBroker: false } }),
    AgentProfile.updateMany({}, { $set: { showAsLicensedBroker: false } }),
  ])
  const [ownerEnabled, agentEnabled] = await Promise.all([
    AgencyOwnerProfile.updateMany({ licenseNumber: LICENSE_PRESENT }, { $set: { showAsLicensedBroker: true } }),
    AgentProfile.updateMany(
      { userId: { $in: autoEnableAgentUserIds }, licenseNumber: LICENSE_PRESENT },
      { $set: { showAsLicensedBroker: true } },
    ),
  ])

  const appliedIndexes = [
    await db.collection(AgentProfile.collection.name).createIndex(
      { organizationId: 1, showAsLicensedBroker: 1 },
      { name: 'agent_profile_org_public_broker' },
    ),
    await db.collection(AgencyOwnerProfile.collection.name).createIndex(
      { organizationId: 1, showAsLicensedBroker: 1 },
      { name: 'agency_owner_profile_org_public_broker' },
    ),
  ]

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    ownerResetMatched: ownerReset.matchedCount,
    ownerEnabledModified: ownerEnabled.modifiedCount,
    agentResetMatched: agentReset.matchedCount,
    agentEnabledModified: agentEnabled.modifiedCount,
    autoEnabledRoles: [...AUTO_ENABLE_AGENT_ROLES, 'agency_owner'],
    explicitlyDisabledByMigration: ['staff', 'viewer'],
    appliedIndexes,
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
