import { describe, expect, it } from 'vitest'
import { tenantResourceFilter } from '../../repositories/tenantRepository'
import fs from 'node:fs'
import path from 'node:path'

describe('tenant resource filters', () => {
  it('does not produce a cross-tenant match even when the Mongo id is known', () => {
    const victim = { _id: 'known-id', organizationId: 'org-victim' }
    const attackerFilter = tenantResourceFilter('org-attacker', 'known-id')
    expect(victim._id === attackerFilter._id && victim.organizationId === attackerFilter.organizationId).toBe(false)
  })
  it('keeps known high-risk CRUD controllers on immutable tenant context', () => {
    const projectRoot = path.resolve(__dirname, '../../../..')
    for (const relative of ['src/app/module/user/user.controller.ts', 'src/app/module/property/property.controller.ts',
      'src/app/module/lead/lead.controller.ts', 'src/app/module/banner/banner.controller.ts',
      'src/app/module/section/section.controller.ts', 'src/app/module/landingPage/landingPage.controller.ts']) {
      const source = fs.readFileSync(path.join(projectRoot, relative), 'utf8')
      expect(source, relative).not.toMatch(/req\.body\.organizationId/)
    }
  })
})
