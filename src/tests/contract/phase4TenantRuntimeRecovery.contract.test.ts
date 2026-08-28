import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('phase 4 tenant runtime recovery contract', () => {
  it('uses one transition coordinator for cache, Next revalidation, queues and realtime', () => {
    const source = read('src/app/module/tenantAccess/tenantAccessTransition.service.ts')
    expect(source).toContain('CacheInvalidationService.invalidateTenant')
    expect(source).toContain('NextRevalidationService.trigger')
    expect(source).toContain('deferBackgroundWork')
    expect(source).toContain('resumeBackgroundWork')
    expect(source).toContain('RealtimeService.revokeTenantRuntimeAccess')
    expect(source).toContain('access.publicWebsiteAllowed')
  })

  it('defers only business jobs while keeping maintenance jobs available', () => {
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const transition = read('src/app/module/tenantAccess/tenantAccessTransition.service.ts')
    for (const type of ['task_reminder', 'viewing_reminder', 'calendar_sync', 'sms_send', 'meta_capi']) {
      expect(transition).toContain(`'${type}'`)
    }
    for (const type of ['domain_verify', 'asset_finalize', 'support_email']) {
      expect(transition).toContain(`'${type}'`)
    }
    expect(queue).toContain('TenantAccessService.evaluate')
    expect(queue).toContain("error.code = 'TENANT_ACCESS_DEFERRED'")
    expect(queue).toContain('$inc: { attempts: -1 }')
    expect(queue).toContain('accessDeferredAt: null')
  })

  it('preserves scheduled website publish times while access is locked', () => {
    const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(website).toContain('originalScheduledPublishAt')
    expect(website).toContain('accessDeferredAt: now')
    expect(website).toContain('$unset: { accessDeferredAt: 1 }')
    expect(website).toContain('backgroundBusinessWorkAllowed')
  })

  it('synchronizes access after expiry, payment recovery and platform lifecycle changes', () => {
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const manualPayment = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    const admin = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const tenantManagement = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')

    expect(lifecycle).toContain("source: 'subscription_boundary'")
    expect(manualPayment).toContain("source: idempotent ? 'manual_payment_confirmation_retry' : 'manual_payment_confirmation'")
    expect(bkash).toContain("source: 'bkash_payment_confirmation_retry'")
    expect(admin).toContain("source: 'platform_suspend'")
    expect(admin).toContain("source: 'platform_reactivate'")
    expect(tenantManagement).toContain("source: 'platform_archive'")
    expect(tenantManagement).toContain("source: 'platform_archive_restore'")
  })

  it('does not republish a website during renewal recovery', () => {
    const transition = read('src/app/module/tenantAccess/tenantAccessTransition.service.ts')
    expect(transition).not.toContain("websiteStatus = 'published'")
    expect(transition).not.toContain("websiteStatus: 'published'")
  })
})
