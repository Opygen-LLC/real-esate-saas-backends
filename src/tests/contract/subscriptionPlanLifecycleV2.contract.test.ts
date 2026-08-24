import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 2 subscription plan lifecycle', () => {
  it('exposes one canonical lifecycle with compatibility mirrors', () => {
    const lifecycle = read('src/app/module/subscriptionPlan/planLifecycle.ts')
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    expect(lifecycle).toContain("'scheduled' | 'current' | 'grandfathered' | 'retired'")
    expect(lifecycle).toContain('resolvePlanStatus')
    expect(model).toContain("enum: ['scheduled', 'current', 'grandfathered', 'retired']")
  })

  it('makes plan identity and lifecycle fields server-owned on version updates', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    expect(validation).toContain('planId: z.never().optional()')
    expect(validation).toContain('grandfatherExisting: z.never().optional()')
    expect(validation).toContain('effectiveFrom: z.never().optional()')
    expect(validation).toContain('isCurrent: z.never().optional()')
  })

  it('creates immutable current versions while grandfathering the previous version', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain("current.status = 'grandfathered'")
    expect(service).toContain('version: nextVersion')
    expect(service).toContain("}, 'current', now)")
    expect(service).toContain('Plan ID is immutable')
    expect(service).toContain('New versions can only be created from the current plan version')
  })

  it('never retires a current version or a version still assigned to tenants', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain('The current plan version cannot be retired')
    expect(service).toContain('cannot be retired')
    expect(service).toContain("plan.status = 'retired'")
  })

  it('ships a guarded lifecycle backfill without changing tenant assignments or plan IDs', () => {
    const migration = read('src/app/db/migrateSubscriptionPlanLifecycleV2.ts')
    const pkg = read('package.json')
    expect(migration).toContain('tenantAssignmentMutation: false')
    expect(migration).toContain('planIdMutation: false')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('mongoSupportsTransactions')
    expect(pkg).toContain('migrate:subscription-plan-lifecycle')
  })
})
