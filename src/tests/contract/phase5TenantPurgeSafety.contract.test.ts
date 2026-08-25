import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import {
  PROTECTED_PLATFORM_COLLECTIONS,
  TENANT_DELETION_COLLECTIONS,
  USER_LINKED_DELETION_COLLECTIONS,
} from '../../app/module/compliance/tenantDataCollections'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(absolute) : [absolute]
})

const collectionNameFromModel = (source: string): string | null => {
  const explicit = source.match(/collection\s*:\s*['"]([^'"]+)['"]/i)?.[1]
  if (explicit) return explicit.toLowerCase()
  const modelName = source.match(/(?:mongoose\.)?model(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]/m)?.[1]
  if (!modelName) return null
  const pluralize = mongoose.pluralize()
  return String(pluralize ? pluralize(modelName.toLowerCase()) : modelName.toLowerCase()).toLowerCase()
}

describe('Phase 5 tenant hard-delete safety contracts', () => {
  it('automatically fails when a new organizationId-scoped model is missing from the deletion registry', () => {
    const modelRoot = path.join(root, 'src/app/module')
    const registered = new Set<string>(TENANT_DELETION_COLLECTIONS)
    const missing: Array<{ file: string; collection: string }> = []

    for (const file of walk(modelRoot).filter((value) => value.endsWith('.model.ts'))) {
      const source = fs.readFileSync(file, 'utf8')
      if (!/organizationId\s*:\s*\{/.test(source) && !/organizationId\s*:\s*String/.test(source)) continue
      const collection = collectionNameFromModel(source)
      if (!collection || collection === 'organizations') continue // Organization root is deleted last by design.
      if (!registered.has(collection)) missing.push({ file: path.relative(root, file), collection })
    }

    expect(missing).toEqual([])
  })

  it('keeps protected platform/global collections outside every purge registry', () => {
    const allPurgeCollections = new Set<string>([
      ...TENANT_DELETION_COLLECTIONS,
      ...USER_LINKED_DELETION_COLLECTIONS,
    ])
    const collisions = PROTECTED_PLATFORM_COLLECTIONS.filter((name) => allPurgeCollections.has(name))
    expect(collisions).toEqual([])
    for (const collection of ['superadminprofiles', 'platformsettings', 'subscriptionplans', 'leadaddondefinitions', 'leadtopuppricings']) {
      expect(PROTECTED_PLATFORM_COLLECTIONS).toContain(collection as any)
    }
  })

  it('locks writes before destructive work and blocks authenticated plus public write paths', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const barrier = read('src/app/module/compliance/tenantPurgeBarrier.service.ts')
    const auth = read('src/app/middlewares/auth.ts')

    expect(purge.indexOf("status: 'pending_deletion'")).toBeGreaterThan(-1)
    expect(purge.indexOf('await org.save()')).toBeLessThan(purge.indexOf('await convergePurgeBoundaries'))
    expect(barrier).toContain("'TENANT_PURGING'")
    expect(barrier).toContain("'platformAccess.status': PURGING_STATUS")
    expect(auth).toContain('TenantPurgeBarrier.assertRequestWritable(req.method, req.tenant?.organizationId)')

    for (const file of [
      'src/app/module/visitorLogs/visitorLogs.controller.ts',
      'src/app/module/review/review.service.ts',
      'src/app/module/metaIntegration/metaIntegration.service.ts',
      'src/app/module/websiteSubmission/websiteSubmission.service.ts',
      'src/app/module/viewing/viewing.service.ts',
      'src/app/module/moderation/moderation.controller.ts',
      'src/app/module/teamInvitation/teamInvitation.service.ts',
      'src/app/module/upload/upload.service.ts',
      'src/app/module/websiteBuilder/websiteBuilder.service.ts',
      'src/app/module/domain/domain.service.ts',
      'src/app/module/support/support.service.ts',
    ]) {
      expect(read(file)).toContain('TenantPurgeBarrier.assertTenantWritable')
    }
  })

  it('keeps the organization root until every dependent boundary verifies zero', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const dependentDelete = purge.indexOf('await deleteTenantDependants(organizationId, userIds)')
    const preRootVerify = purge.indexOf('organizationMustExist: true')
    const rootDelete = purge.indexOf('await deleteOrganizationRoot(organizationId)')
    const finalVerify = purge.indexOf('organizationMustExist: false')

    expect(dependentDelete).toBeGreaterThan(-1)
    expect(preRootVerify).toBeGreaterThan(dependentDelete)
    expect(rootDelete).toBeGreaterThan(preRootVerify)
    expect(finalVerify).toBeGreaterThan(rootDelete)
    expect(purge).toContain('purgeUserIds: userIds.map(String)')
  })

  it('requires a strict zero-data scan across DB, sessions, jobs, GCS, domains, sockets and Redis', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    for (const token of [
      'remainingCollections',
      'remainingUserLinkedCollections',
      'activeSessions',
      'operationsJobs',
      'activeSockets',
      'redisKeys',
      'gcsTenantObjects',
      'registeredTenantDomains',
      "'TENANT_PURGE_INCOMPLETE'",
    ]) expect(purge).toContain(token)

    expect(read('src/app/module/compliance/tenantExternalResources.service.ts')).toContain('verificationState')
    expect(read('src/app/module/realtime/realtime.service.ts')).toContain('countOrganizationSockets')
    expect(read('src/app/module/realtime/realtime.service.ts')).toContain('countUserSockets')
    expect(read('src/app/module/domainEvent/cacheInvalidation.service.ts')).toContain('countTenantKeys')
    expect(read('src/shared/redisClient.ts')).toContain('const countMatching = async')
  })

  it('uses retry-safe/idempotent cleanup primitives', () => {
    expect(read('src/app/module/websiteBuilder/objectStorage.service.ts')).toContain('delete({ ignoreNotFound: true })')
    expect(read('src/app/module/websiteBuilder/objectStorage.service.ts')).toContain('deleteFiles({ prefix: normalized, force: true })')
    expect(read('src/app/module/domain/providers/vercelDomainProvider.ts')).toContain('Promise.allSettled([removeOne(domain), removeOne(`www.${domain}`)])')
    expect(read('src/app/module/operationsQueue/operationsQueue.service.ts')).toContain('const cancelOrganization = async')
    expect(read('src/app/module/compliance/tenantPurge.service.ts')).toContain('All operations below are intentionally idempotent')
  })

  it('retains Super Admin-only routing and exact dual confirmation from earlier phases', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const management = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')
    expect(route).toContain("router.post('/tenants/:organizationId/hard-delete', authMiddlewares.authSuperAdmin")
    expect(route).toContain("confirmationText: z.literal('DELETE PERMANENTLY')")
    expect(management).toContain('confirmedOrganizationId !== routeOrganizationId')
    expect(management).toContain("confirmationText !== 'DELETE PERMANENTLY'")
  })
})
