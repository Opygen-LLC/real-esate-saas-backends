import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const service = read('src/app/module/user/user.service.ts')
const route = read('src/app/module/user/user.route.ts')
const validation = read('src/app/module/user/user.validation.ts')
const profileService = read('src/app/module/user/userProfile.service.ts')
const agentProfile = read('src/app/module/agentProfile/agentProfile.model.ts')
const ownerProfile = read('src/app/module/agencyOwnerProfile/agencyOwnerProfile.model.ts')
const migration = read('src/app/db/migratePhase8LicensedBrokerVisibility.ts')

const publicListSlice = service.slice(service.indexOf('const getPublicAgents'), service.indexOf('const getPublicAgentDetail'))
const publicDetailSlice = service.slice(service.indexOf('const getPublicAgentDetail'), service.indexOf('const updatePublicBrokerProfile'))
const updateSlice = service.slice(service.indexOf('const updatePublicBrokerProfile'), service.indexOf('const getAgentLeaderboard'))

describe('Phase 8 licensed broker visibility contract', () => {
  it('stores canonical visibility on both role-profile models and exposes it through the user DTO projection', () => {
    expect(agentProfile).toContain('showAsLicensedBroker')
    expect(ownerProfile).toContain('showAsLicensedBroker')
    expect(profileService).toContain('showAsLicensedBroker: roleProfile.showAsLicensedBroker === true')
    expect(profileService).toContain('showAsLicensedBroker: source.showAsLicensedBroker === true')
  })

  it('requires users.write on the dedicated tenant-scoped update endpoint', () => {
    expect(route).toMatch(/'\/:id\/public-broker'[\s\S]*requirePermission\('users\.write'\)[\s\S]*UserValidation\.publicBroker/)
    expect(validation).toMatch(/publicBroker:[\s\S]*showAsLicensedBroker: z\.boolean\(\)[\s\S]*licenseNumber/)
    expect(updateSlice).toContain("User.findOne({ _id: objectId, organizationId })")
    expect(updateSlice).toContain("target.userRole === 'agency_owner' && String(actor._id) !== String(target._id)")
  })

  it('public list and direct detail require active membership, explicit visibility and a non-empty license', () => {
    expect(publicListSlice).toContain("status: 'active'")
    expect(publicListSlice).toContain('publicBrokerVisibilityStage')
    expect(publicDetailSlice).toContain("status: 'active'")
    expect(publicDetailSlice).toContain('publicBrokerVisibilityStage')
    expect(service).toContain("'agencyOwnerProfile.showAsLicensedBroker': true")
    expect(service).toContain("'agentProfile.showAsLicensedBroker': true")
    expect(service).toContain("const LICENSE_PRESENT = /\\S/")
    expect(publicDetailSlice).toContain("throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')")
  })

  it('publishes the same team.changed hint to dashboard and public tenant rooms after a successful update', () => {
    expect(updateSlice).toContain("type: 'team.changed' as const")
    expect(updateSlice).toContain('RealtimeService.emitOrganization(organizationId, event)')
    expect(updateSlice).toContain('RealtimeService.emitPublicOrganization(organizationId, event)')
  })

  it('migration enables licensed owners/agents/admins while leaving staff/viewers disabled and installs production indexes', () => {
    expect(migration).toContain("const AUTO_ENABLE_AGENT_ROLES = ['agency_admin', 'agent'] as const")
    expect(migration).toContain('AgencyOwnerProfile.updateMany({ licenseNumber: LICENSE_PRESENT }')
    expect(migration).toContain('AgentProfile.updateMany({}, { $set: { showAsLicensedBroker: false } })')
    expect(migration).toContain("explicitlyDisabledByMigration: ['staff', 'viewer']")
    expect(migration).toContain("name: 'agent_profile_org_public_broker'")
    expect(migration).toContain("name: 'agency_owner_profile_org_public_broker'")
  })
})
