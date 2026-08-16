import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { AccountCredential } from '../module/accountCredential/accountCredential.model'
import { AgencyOwnerProfile } from '../module/agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../module/agentProfile/agentProfile.model'
import { AuthSession } from '../module/auth/authSession.model'
import { OtpChallenge } from '../module/auth/otpChallenge.model'
import { Organization } from '../module/organization/organization.model'
import { SuperAdminProfile } from '../module/superAdminProfile/superAdminProfile.model'
import { UserProfile } from '../module/userProfile/userProfile.model'

const apply = process.env.MIGRATION_APPLY === 'true'
const cleanupLegacy = process.env.MIGRATION_CLEANUP_LEGACY === 'true'

const legacyUserFields = [
  'password',
  'verificationCode',
  'codeGenerationTimestamp',
  'profileImgURL',
  'bio',
  'licenseNumber',
  'specialization',
  'serviceAreas',
  'address',
  'gender',
  'isAddProfile',
  'sidebar_permission',
  'accessControl',
] as const

const asObjectId = (value: unknown): Types.ObjectId => {
  if (value instanceof Types.ObjectId) return value
  if (!Types.ObjectId.isValid(String(value || ''))) throw new Error(`Invalid ObjectId encountered during Phase 1 migration`)
  return new Types.ObjectId(String(value))
}

const profileAccess = (raw: any) => ({
  useRoleDefaults: raw?.accessControl?.useRoleDefaults !== false,
  permissions: Array.isArray(raw?.accessControl?.permissions) ? raw.accessControl.permissions : [],
})

const ensureUniqueOwners = (organizations: any[]) => {
  const seen = new Map<string, string>()
  for (const organization of organizations) {
    if (!organization.ownerId) continue
    const ownerId = String(organization.ownerId)
    const previous = seen.get(ownerId)
    if (previous && previous !== organization.organizationId) {
      throw new Error(`User ${ownerId} owns more than one organization (${previous}, ${organization.organizationId}). Resolve this before applying the unique owner index.`)
    }
    seen.set(ownerId, organization.organizationId)
  }
}

async function migrate() {
  await mongoose.connect(config.database_string, { autoIndex: false })
  try {
    const usersCollection = mongoose.connection.collection('users')
    const [users, organizations, existingCredentials] = await Promise.all([
      usersCollection.find({}).toArray(),
      Organization.collection.find({}).toArray(),
      AccountCredential.collection.find({}).project({ userId: 1 }).toArray(),
    ])

    ensureUniqueOwners(organizations)
    const orgById = new Map(organizations.map((organization: any) => [organization.organizationId, organization]))
    const credentialsByUser = new Set(existingCredentials.map((row: any) => String(row.userId)))

    const ownersByOrg = new Map<string, any[]>()
    for (const user of users) {
      if (user.userRole !== 'agency_owner') continue
      const list = ownersByOrg.get(user.organizationId) || []
      list.push(user)
      ownersByOrg.set(user.organizationId, list)
    }

    const ownerRepairs: Array<{ organizationId: string; ownerId: Types.ObjectId }> = []
    for (const [organizationId, ownerUsers] of ownersByOrg) {
      const organization: any = orgById.get(organizationId)
      if (!organization) throw new Error(`Agency owner user references missing organization ${organizationId}`)
      if (ownerUsers.length > 1 && !organization.ownerId) {
        throw new Error(`Organization ${organizationId} has ${ownerUsers.length} agency_owner users but no ownerId; ownership is ambiguous.`)
      }
      if (!organization.ownerId && ownerUsers.length === 1) {
        ownerRepairs.push({ organizationId, ownerId: asObjectId(ownerUsers[0]._id) })
      } else if (organization.ownerId && ownerUsers.length > 0 && !ownerUsers.some((user) => String(user._id) === String(organization.ownerId))) {
        throw new Error(`Organization ${organizationId} ownerId conflicts with its agency_owner role assignment.`)
      }
    }

    const missingPasswords = users.filter((user: any) => !credentialsByUser.has(String(user._id)) && typeof user.password !== 'string')
    if (missingPasswords.length) {
      throw new Error(`${missingPasswords.length} user(s) have neither AccountCredential nor a legacy password. Repair those records before migration.`)
    }

    const credentials = [] as any[]
    const profiles = [] as any[]
    const ownerProfiles = [] as any[]
    const agentProfiles = [] as any[]
    const superAdminProfiles = [] as any[]

    for (const raw of users as any[]) {
      const userId = asObjectId(raw._id)
      if (!credentialsByUser.has(String(userId))) {
        credentials.push({
          updateOne: {
            filter: { userId },
            update: {
              $setOnInsert: {
                userId,
                passwordHash: raw.password,
                passwordChangedAt: raw.updatedAt || raw.createdAt || new Date(),
                emailVerifiedAt: raw.isVerified ? (raw.updatedAt || raw.createdAt || new Date()) : null,
                failedLoginCount: 0,
              },
            },
            upsert: true,
          },
        })
      }

      profiles.push({
        updateOne: {
          filter: { userId },
          update: {
            $setOnInsert: {
              userId,
              profileImgURL: raw.profileImgURL || '',
              bio: raw.bio || '',
              address: raw.address || '',
              gender: raw.gender || '',
              isAddProfile: raw.isAddProfile !== false,
              sidebarPermission: raw.sidebar_permission || {},
              accessControl: profileAccess(raw),
            },
          },
          upsert: true,
        },
      })

      const commonRoleFields = {
        licenseNumber: raw.licenseNumber || '',
        specialization: Array.isArray(raw.specialization) ? raw.specialization : [],
        serviceAreas: Array.isArray(raw.serviceAreas) ? raw.serviceAreas : [],
      }
      if (raw.userRole === 'agency_owner') {
        ownerProfiles.push({
          updateOne: {
            filter: { userId },
            update: { $setOnInsert: { userId, organizationId: raw.organizationId, ...commonRoleFields } },
            upsert: true,
          },
        })
      } else if (raw.userRole === 'super-admin') {
        superAdminProfiles.push({
          updateOne: {
            filter: { userId },
            update: { $setOnInsert: { userId, title: 'Platform Administrator' } },
            upsert: true,
          },
        })
      } else {
        agentProfiles.push({
          updateOne: {
            filter: { userId },
            update: { $setOnInsert: { userId, organizationId: raw.organizationId, ...commonRoleFields } },
            upsert: true,
          },
        })
      }
    }

    const legacySessionCount = await AuthSession.collection.countDocuments({ tokenHash: { $exists: true, $nin: ['', null] } })
    const legacyUserCount = await usersCollection.countDocuments({ $or: legacyUserFields.map((field) => ({ [field]: { $exists: true } })) })

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      cleanupLegacy,
      users: users.length,
      accountCredentialsToCreate: credentials.length,
      userProfilesToUpsert: profiles.length,
      agencyOwnerProfilesToUpsert: ownerProfiles.length,
      agentProfilesToUpsert: agentProfiles.length,
      superAdminProfilesToUpsert: superAdminProfiles.length,
      organizationOwnerRepairs: ownerRepairs.length,
      legacySessions: legacySessionCount,
      usersWithLegacyFields: legacyUserCount,
    }, null, 2))

    if (!apply) {
      console.log('Dry run complete. Re-run with MIGRATION_APPLY=true to backfill. Add MIGRATION_CLEANUP_LEGACY=true only after the new application release is healthy.')
      return
    }

    if (ownerRepairs.length) {
      await Organization.collection.bulkWrite(ownerRepairs.map((repair) => ({
        updateOne: { filter: { organizationId: repair.organizationId, ownerId: { $exists: false } }, update: { $set: { ownerId: repair.ownerId } } },
      })))
    }
    if (credentials.length) await AccountCredential.collection.bulkWrite(credentials, { ordered: false })
    if (profiles.length) await UserProfile.collection.bulkWrite(profiles, { ordered: false })
    if (ownerProfiles.length) await AgencyOwnerProfile.collection.bulkWrite(ownerProfiles, { ordered: false })
    if (agentProfiles.length) await AgentProfile.collection.bulkWrite(agentProfiles, { ordered: false })
    if (superAdminProfiles.length) await SuperAdminProfile.collection.bulkWrite(superAdminProfiles, { ordered: false })

    // Backfill the improved session shape but retain tokenHash until the cleanup pass.
    await AuthSession.collection.updateMany(
      { tokenHash: { $exists: true, $nin: ['', null] }, $or: [{ refreshTokenHash: { $exists: false } }, { refreshTokenHash: '' }] },
      [{ $set: { refreshTokenHash: '$tokenHash', sessionVersion: { $ifNull: ['$sessionVersion', 1] }, lastUsedIp: { $ifNull: ['$lastUsedIp', '$createdIp'] } } }],
    )

    // Normalize OTP records. The code/reset hashes stay in OtpChallenge, never in User/AccountCredential.
    const organizationByUser = new Map((users as any[]).map((user) => [String(user._id), user.organizationId]))
    const otpWithoutOrg = await OtpChallenge.collection.find({ userId: { $exists: true }, $or: [{ organizationId: { $exists: false } }, { organizationId: '' }] }).project({ _id: 1, userId: 1 }).toArray()
    if (otpWithoutOrg.length) {
      const otpOrgWrites = otpWithoutOrg.flatMap((challenge: any) => {
        const organizationId = organizationByUser.get(String(challenge.userId))
        return organizationId ? [{ updateOne: { filter: { _id: challenge._id }, update: { $set: { organizationId } } } }] : []
      })
      if (otpOrgWrites.length) await OtpChallenge.collection.bulkWrite(otpOrgWrites)
    }
    await OtpChallenge.collection.updateMany({ maxAttempts: { $exists: false } }, { $set: { maxAttempts: 5 } })
    await OtpChallenge.collection.updateMany({ attempts: { $exists: false } }, { $set: { attempts: 0 } })

    // Replace any older sparse owner index before creating the Phase 1 partial unique index.
    // A same-name index with different options causes MongoDB IndexOptionsConflict.
    const organizationIndexes = await Organization.collection.indexes()
    for (const index of organizationIndexes) {
      if (index.name !== '_id_' && index.key && (index.key as Record<string, number>).ownerId === 1) {
        await Organization.collection.dropIndex(index.name as string)
      }
    }

    // Create indexes explicitly because production connects with autoIndex disabled.
    await Promise.all([
      AccountCredential.collection.createIndex({ userId: 1 }, { unique: true, name: 'account_credential_user_unique' }),
      UserProfile.collection.createIndex({ userId: 1 }, { unique: true, name: 'user_profile_user_unique' }),
      AgencyOwnerProfile.collection.createIndex({ userId: 1 }, { unique: true, name: 'agency_owner_profile_user_unique' }),
      AgencyOwnerProfile.collection.createIndex({ organizationId: 1 }, { unique: true, name: 'agency_owner_profile_org_unique' }),
      AgentProfile.collection.createIndex({ userId: 1 }, { unique: true, name: 'agent_profile_user_unique' }),
      SuperAdminProfile.collection.createIndex({ userId: 1 }, { unique: true, name: 'super_admin_profile_user_unique' }),
      Organization.collection.createIndex(
        { ownerId: 1 },
        { unique: true, partialFilterExpression: { ownerId: { $type: 'objectId' } }, name: 'organization_owner_unique' },
      ),
    ])

    if (cleanupLegacy) {
      const unsetLegacy = Object.fromEntries(legacyUserFields.map((field) => [field, '']))
      await usersCollection.updateMany({}, { $unset: unsetLegacy })
      await AuthSession.collection.updateMany({ tokenHash: { $exists: true } }, { $unset: { tokenHash: '' } })
    }

    const [credentialCount, profileCount, usersStillLegacy] = await Promise.all([
      AccountCredential.collection.countDocuments({ userId: { $in: users.map((user: any) => user._id) } }),
      UserProfile.collection.countDocuments({ userId: { $in: users.map((user: any) => user._id) } }),
      usersCollection.countDocuments({ $or: legacyUserFields.map((field) => ({ [field]: { $exists: true } })) }),
    ])
    if (credentialCount !== users.length) throw new Error(`Verification failed: expected ${users.length} credentials, found ${credentialCount}`)
    if (profileCount !== users.length) throw new Error(`Verification failed: expected ${users.length} user profiles, found ${profileCount}`)
    if (cleanupLegacy && usersStillLegacy !== 0) throw new Error(`Verification failed: ${usersStillLegacy} user(s) still contain legacy fields`)

    console.log(`Phase 1 user/auth migration applied successfully${cleanupLegacy ? ' with legacy cleanup' : ' (backfill only)'}.`)
  } finally {
    await mongoose.disconnect()
  }
}

migrate().catch((error) => {
  console.error('Phase 1 user/auth migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
