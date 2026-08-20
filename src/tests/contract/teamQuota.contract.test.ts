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
    const userService = read('src/app/module/user/user.service.ts')
    const userRoute = read('src/app/module/user/user.route.ts')
    const userModel = read('src/app/module/user/user.model.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(reconcile).toContain("userRole: { $ne: 'agency_owner' }")
    expect(reconcile).toContain("source: 'subscription_quota'")
    expect(reconcile).toContain("revokeReason: 'subscription_quota'")
    expect(userService).toContain("'TEAM_SEAT_LIMIT_REACHED'")
    expect(userService).toContain('httpStatus.CONFLICT')
    expect(userRoute).toContain("'/:id/seat-access'")
    expect(userRoute).toContain("authMiddlewares.auth('agency_owner')")
    expect(userModel).toContain("'subscription_quota'")
    expect(userModel).toContain("'tenant_admin'")
    expect(userModel).toContain("'platform_admin'")
    expect(bkash).toContain('reconcileTeamSeats')
    expect(bkash).toContain('withTeamMemberQuotaGuard')
  })

})
