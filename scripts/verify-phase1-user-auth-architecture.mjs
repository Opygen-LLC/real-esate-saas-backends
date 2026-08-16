import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const userModel = read('src/app/module/user/user.model.ts')
for (const legacy of ['password:', 'verificationCode:', 'codeGenerationTimestamp:', 'profileImgURL:', 'licenseNumber:', 'accessControl:']) {
  assert(!userModel.includes(legacy), `Core User schema still defines legacy field: ${legacy}`)
}

const credential = read('src/app/module/accountCredential/accountCredential.model.ts')
assert(credential.includes("passwordHash: { type: String, required: true, select: false }"), 'AccountCredential passwordHash must be required and select:false')
assert(credential.includes("unique: true, name: 'account_credential_user_unique'"), 'AccountCredential must enforce one-to-one userId')

for (const [file, index] of [
  ['src/app/module/userProfile/userProfile.model.ts', 'user_profile_user_unique'],
  ['src/app/module/agencyOwnerProfile/agencyOwnerProfile.model.ts', 'agency_owner_profile_user_unique'],
  ['src/app/module/agentProfile/agentProfile.model.ts', 'agent_profile_user_unique'],
  ['src/app/module/superAdminProfile/superAdminProfile.model.ts', 'super_admin_profile_user_unique'],
]) {
  assert(read(file).includes(index), `${file} is missing its one-to-one unique index`)
}

const ownerProfile = read('src/app/module/agencyOwnerProfile/agencyOwnerProfile.model.ts')
assert(ownerProfile.includes('agency_owner_profile_org_unique'), 'AgencyOwnerProfile must enforce one owner profile per organization')

const organization = read('src/app/module/organization/organization.model.ts')
assert(organization.includes('organization_owner_unique') && organization.includes('partialFilterExpression'), 'Organization.ownerId must have a safe unique partial index')

const authSession = read('src/app/module/auth/authSession.model.ts')
assert(authSession.includes('refreshTokenHash') && authSession.includes('select: false'), 'AuthSession must store only a hidden refresh-token hash')
assert(authSession.includes('sessionVersion') && authSession.includes('rotatedAt'), 'AuthSession rotation metadata is missing')

const otp = read('src/app/module/auth/otpChallenge.model.ts')
assert(otp.includes("codeHash: { type: String, required: true, select: false }"), 'OTP code hash must be select:false')
assert(otp.includes("resetTokenHash: { type: String, default: '', select: false }"), 'Reset token hash must be select:false')

const auth = read('src/app/module/auth/auth.services.ts')
assert(auth.includes("AccountCredential.findOne({ userId: user._id }).select('+passwordHash')"), 'Login/password flows must use AccountCredential')
assert(!/User\.find[^\n]*select\([^\n]*password/.test(auth), 'Auth service still reads password from User')

const migration = read('src/app/db/migratePhase1UserAuthArchitecture.ts')
assert(migration.includes("MIGRATION_CLEANUP_LEGACY === 'true'"), 'Migration must separate backfill from destructive cleanup')
assert(migration.includes('usersWithLegacyFields'), 'Migration must report legacy field cleanup state')

const dto = read('src/app/module/user/user.dto.ts')
assert(dto.includes('export interface UserResponseDto') && dto.includes('export interface AuthUserResponseDto'), 'Explicit user response DTOs are missing')

for (const file of [
  'src/app/module/property/property.service.ts',
  'src/app/module/lead/lead.service.ts',
  'src/app/module/viewing/viewing.service.ts',
  'src/app/module/task/task.service.ts',
  'src/app/module/activity/activity.service.ts',
  'src/app/module/finance/finance.service.ts',
]) {
  assert(read(file).includes('userRefPopulate'), `${file} has not migrated User profile population`)
}

console.log('Phase 1 user/auth architecture verification passed.')
