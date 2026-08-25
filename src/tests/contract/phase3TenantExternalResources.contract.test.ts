import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 3 tenant external-resource purge contracts', () => {
  it('deletes and verifies both tenant-owned GCS prefixes plus referenced legacy uploads', () => {
    const external = read('src/app/module/compliance/tenantExternalResources.service.ts')
    const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')

    expect(external).toContain('`tenants/${organizationId}/`')
    expect(external).toContain('`support/${organizationId}/`')
    expect(external).toContain("key.startsWith('uploads/')")
    expect(external).toContain('ObjectStorageService.removePrefix')
    expect(external).toContain('ObjectStorageService.remove(key)')
    expect(external).toContain('ObjectStorageService.prefixHasObjects')
    expect(external).toContain('ObjectStorageService.exists(key)')
    expect(external).toContain("'TENANT_PURGE_STORAGE_FAILED'")
    expect(external).toContain("'TENANT_PURGE_EXTERNAL_CLEANUP_FAILED'")

    expect(storage).toContain('const removePrefix = async')
    expect(storage).toContain('deleteFiles({ prefix: normalized, force: true })')
    expect(storage).toContain('const prefixHasObjects = async')
    expect(storage).toContain('const keyFromReference = (value: string)')
  })

  it('moves legacy upload.service writes into the tenant GCS namespace', () => {
    const upload = read('src/app/module/upload/upload.service.ts')
    const controller = read('src/app/module/upload/upload.controller.ts')

    expect(upload).toContain('const uploadFile = async (organizationId: string')
    expect(upload).toContain('`tenants/${tenantId}/uploads/${Date.now()}-')
    expect(upload).toContain('ObjectStorageService.putBuffer')
    expect(upload).toContain('ObjectStorageService.publicUrl')
    expect(upload).not.toContain('`uploads/${')
    expect(controller).toContain('StorageService.uploadFile(organizationId, file)')
    expect(controller).toContain('StorageService.uploadMultipleFiles(organizationId, files)')
  })

  it('collects current, candidate and retired domains and removes/verifies provider registrations', () => {
    const external = read('src/app/module/compliance/tenantExternalResources.service.ts')
    const providerContract = read('src/app/module/domain/providers/domainProvider.ts')
    const vercel = read('src/app/module/domain/providers/vercelDomainProvider.ts')

    expect(external).toContain("select('domain candidate.domain retiredDomains.domain')")
    expect(external).toContain('(record as any)?.candidate?.domain')
    expect(external).toContain('(record as any)?.retiredDomains')
    expect(external).toContain('provider.removeDomain(domain)')
    expect(external).toContain('provider.hasDomain(domain)')
    expect(providerContract).toContain('hasDomain(domain: string): Promise<boolean>')
    expect(vercel).toContain('Promise.allSettled([removeOne(domain), removeOne(`www.${domain}`)])')
    expect(vercel).toContain('Promise.all([getProjectDomain(domain), getProjectDomain(`www.${domain}`)])')
  })

  it('revokes tenant auth, sessions, sockets, caches and jobs before database deletion', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const cache = read('src/app/module/domainEvent/cacheInvalidation.service.ts')
    const realtime = read('src/app/module/realtime/realtime.service.ts')

    const externalDelete = purge.indexOf('TenantExternalResourcesService.deleteStorage')
    const databaseDelete = purge.indexOf('const execute = async')
    expect(externalDelete).toBeGreaterThan(-1)
    expect(databaseDelete).toBeGreaterThan(externalDelete)
    expect(purge).toContain("revokeReason: 'tenant_hard_delete'")
    expect(purge).toContain('ImpersonationSession.updateMany')
    expect(purge).toContain('OperationsQueueService.cancelOrganization(organizationId)')
    expect(purge).toContain('CacheInvalidationService.invalidateTenant')
    expect(purge).toContain('RealtimeService.disconnectOrganization(organizationId)')
    expect(purge).toContain('RealtimeService.disconnectUser')

    expect(queue).toContain("'platformAccess.status': { $ne: 'pending_deletion' }")
    expect(queue).toContain('const cancelOrganization = async')
    expect(queue).toContain("status: { $in: ['pending', 'processing'] }")
    expect(queue).toContain('tenantCanRunBackgroundWork(job.organizationId)')
    expect(cache).toContain('Cache.website.delAll(organizationId)')
    expect(realtime).toContain('const disconnectOrganization = async')
  })

  it('guards direct recurring workers from processing a tenant once purge begins', () => {
    const files = [
      'src/app/module/websiteBuilder/websiteBuilder.service.ts',
      'src/app/module/subscription/subscriptionSchedule.service.ts',
      'src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts',
      'src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts',
      'src/app/module/subscription/subscriptionLifecycle.service.ts',
      'src/app/module/subscriptionPlan/subscriptionPlan.service.ts',
    ]
    for (const file of files) {
      expect(read(file)).toContain('pending_deletion')
    }
  })
})
