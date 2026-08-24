import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 2 team quota invariants', () => {
  it('uses teamMembers as the only entitlement resource name while retaining maxAgents only as persistence compatibility', () => {
    const source = read('src/app/module/entitlement/entitlement.service.ts')
    expect(source).toContain("export type LimitedResource = 'properties' | 'teamMembers' | 'leads'")
    expect(source).not.toMatch(/LimitedResource[^\n]*'agents'/)
    expect(source).toContain("resource === 'teamMembers' ? 'maxAgents'")
  })

  it('counts valid pending invitations and serializes quota-sensitive writes per tenant', () => {
    const source = read('src/app/module/entitlement/entitlement.service.ts')
    expect(source).toContain("status: 'pending', expiresAt: { $gt: new Date() }")
    expect(source).toContain('teamQuotaRevision: 1')
    expect(source).toContain('withTeamMemberQuotaGuard')
    expect(source).toContain('session.withTransaction')
    expect(source).toContain('let completed = false')
    expect(source).toContain('completed = true')
    expect(source).not.toContain("if (value === undefined) throw new ApiError(500, 'Team quota transaction did not complete')")
  })

  it('reserves one seat when inviting and does not double-count that reservation during acceptance', () => {
    const source = read('src/app/module/teamInvitation/teamInvitation.service.ts')
    expect(source).toContain('additionalCommitments: 1')
    expect(source).toContain('additionalCommitments: 0')
    expect(source).toContain('withTeamMemberQuotaGuard')
    expect(source).toContain("status: 'revoked'")
  })

  it('exposes only canonical active/reserved/available quota fields from billing usage', () => {
    const source = read('src/app/module/billing/billing.service.ts')
    for (const field of [
      'maxTeamMembers',
      'teamMembersUsed',
      'teamMembersReserved',
      'teamMembersCommitted',
      'teamMembersAvailable',
      'teamMembersOverCapacityBy',
    ]) {
      expect(source).toContain(field)
    }
    expect(source).not.toMatch(/\bagents\s*:/)
  })

  it('does not expose the old agents quota alias from platform tenant usage', () => {
    const source = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    expect(source).not.toMatch(/\bagents\s*:\s*teamMembers/)
    expect(source).toContain('subscription: toTeamMemberLimitContract')
  })

  it('ships explicit production indexes for pending-invitation quota queries', () => {
    const source = read('src/app/db/migrateTeamQuota.ts')
    expect(source).toContain('tenant_phone_status')
    expect(source).toContain('tenant_status_expires')
    expect(source).toContain('--apply')
  })

  it('ships owner-protected downgrade reconciliation and an exact 409 unblock contract', () => {
    const reconcile = read('src/app/module/entitlement/teamSeatReconciliation.service.ts')
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    const userService = read('src/app/module/user/user.service.ts')
    const userRoute = read('src/app/module/user/user.route.ts')
    const userModel = read('src/app/module/user/user.model.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(reconcile).toContain('resolveCanonicalOwner')
    expect(reconcile).toContain('protectedOwnerUserId')
    expect(reconcile).toContain('canonical_owner>agency_admin>agent>staff>viewer>oldest_membership>id')
    expect(reconcile).not.toContain("filter: { _id: user._id, organizationId, userRole: { $ne: 'agency_owner' } }")
    expect(reconcile).toContain("source: 'subscription_quota'")
    expect(reconcile).toContain("revokeReason: 'subscription_quota'")
    expect(reconcile).toContain("action: 'subscription.team_seats_reconciled'")
    expect(entitlement).toContain('resolved.organization.ownerId')
    expect(entitlement).not.toContain("{ userRole: 'agency_owner' }")
    expect(userService).toContain("'TEAM_SEAT_LIMIT_REACHED'")
    expect(userService).toContain('httpStatus.CONFLICT')
    expect(userRoute).toContain("'/:id/seat-access'")
    expect(userRoute).toContain("authMiddlewares.auth('agency_owner', 'agency_admin')")
    expect(userRoute).toContain("authMiddlewares.requirePermission('users.write')")
    expect(userService).toContain("'OWNER_SEAT_PROTECTED'")
    expect(userService).toContain("'SELF_SEAT_ACCESS_FORBIDDEN'")
    expect(userService).toContain("'TEAM_SEAT_ACCESS_FORBIDDEN'")
    expect(userService).toContain('quota.teamMembersCommitted >= quota.maxTeamMembers')
    expect(userService).toContain('Pending invitations are commitments too')
    expect(userService).toContain('return { changed: false }')
    expect(userService).toContain('return { changed: true }')
    expect(userModel).toContain("'subscription_quota'")
    expect(userModel).toContain("'tenant_admin'")
    expect(userModel).toContain("'platform_admin'")
    expect(bkash).toContain('reconcileOrganizationEntitlements')
    expect(bkash).toContain('withTeamMemberQuotaGuard')
  })

  it('backfills legacy blocked accounts as platform-controlled restrictions', () => {
    const migration = read('src/app/db/migrateAccessRestrictionProvenance.ts')
    const packageJson = read('package.json')
    expect(migration).toContain("status: 'blocked'")
    expect(migration).toContain("source: 'platform_admin'")
    expect(migration).toContain('Legacy blocked account migrated as platform-controlled restriction')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('user_tenant_access_restriction')
    expect(packageJson).toContain('migrate:access-restrictions')
  })

})
