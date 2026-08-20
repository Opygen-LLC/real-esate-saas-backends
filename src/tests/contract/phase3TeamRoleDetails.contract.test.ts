import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHASE0_REGRESSION_CONTRACTS } from '../../contracts/dashboardRegressionContracts'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 3 team role details contract', () => {
  it('keeps role percentages independent rather than dividing by the whole roster', () => {
    expect(PHASE0_REGRESSION_CONTRACTS.teamRolePercentages).toMatchObject({
      denominator: 'members-in-role',
      independentPerRole: true,
      activeRolePercentage: 100,
      source: 'tenant-active-role-summary',
    })
  })

  it('serves a tenant-scoped active role summary behind users.read', () => {
    const route = read('src/app/module/user/user.route.ts')
    const controller = read('src/app/module/user/user.controller.ts')
    const service = read('src/app/module/user/user.service.ts')

    expect(route).toContain("'/team-summary'")
    expect(route).toMatch(/'\/team-summary'[\s\S]{0,160}requirePermission\('users\.read'\)/)
    expect(route.indexOf("'/team-summary'")).toBeLessThan(route.indexOf("'/:id'"))
    expect(controller).toMatch(/getTeamRoleSummary[\s\S]{0,180}requireTenant\(req\)/)
    expect(service).toContain("status: 'active'")
    expect(service).toContain('organizationId')
    expect(service).toContain("$group: { _id: '$userRole', activeCount: { $sum: 1 } }")
    expect(service).toContain('TEAM_MEMBER_SEAT_ROLES')
    expect(service).not.toMatch(/activeCount\s*\/\s*totalActive/)
  })
})
