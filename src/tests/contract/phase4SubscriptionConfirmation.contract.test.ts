import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const service = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const model = read('src/app/module/subscriptionPayment/subscriptionPayment.model.ts')
const routes = read('src/app/module/billing/billing.route.ts')
const realtimeTypes = read('src/app/module/realtime/realtime.types.ts')
const migration = read('src/app/db/migratePhase4SubscriptionConfirmation.ts')

describe('Phase 4 subscription confirmation lifecycle', () => {
  it('emits a sanitized subscription.changed event only after transaction/cache work', () => {
    expect(realtimeTypes).toContain("'subscription.changed'")
    expect(service).toContain("type: 'subscription.changed'")
    expect(service).toContain("action: 'confirmed'")
    expect(service.indexOf('await CacheInvalidationService.invalidateTenant(organizationId)')).toBeLessThan(service.indexOf("type: 'subscription.changed'"))
    const realtimeBlock = service.slice(service.indexOf("type: 'subscription.changed'"), service.indexOf('return result', service.indexOf("type: 'subscription.changed'")))
    expect(realtimeBlock).not.toMatch(/amount|method|reference|notes|proofAssetId/)
  })

  it('stores per-user acknowledgement internally and never replays legacy confirmations', () => {
    expect(model).toMatch(/confirmationNoticeEligible: \{ type: Boolean, default: false, select: false \}/)
    expect(model).toMatch(/customerAcknowledgedBy: \{ type: \[String\], default: \[\], select: false \}/)
    expect(service).toContain('payment.confirmationNoticeEligible = true')
    expect(service).toContain('payment.customerAcknowledgedBy = []')
    expect(service).toContain('confirmationNoticeEligible: true')
    expect(service).toContain('customerAcknowledgedBy: { $ne: userId }')
    expect(service).toContain('$addToSet: { customerAcknowledgedBy: userId }')
    expect(migration).toContain('Existing confirmed payments are intentionally left without confirmationNoticeEligible=true')
  })

  it('tenant-scopes both read and acknowledgement endpoints behind billing.manage', () => {
    expect(routes).toMatch(/get\('\/unacknowledged-confirmation', authMiddlewares\.requirePermission\('billing\.manage'\)/)
    expect(routes).toMatch(/patch\('\/history\/:paymentNumber\/acknowledge', authMiddlewares\.requirePermission\('billing\.manage'\)/)
    expect(service).toMatch(/SubscriptionPayment\.findOne\(\{\s*organizationId,/)
    expect(service).toMatch(/\{ organizationId, paymentNumber, status: 'confirmed', confirmationNoticeEligible: true \}/)
  })

  it('uses a stable newest-confirmation query and a production delivery index', () => {
    expect(service).toContain(".sort({ confirmedAt: -1, _id: -1 })")
    expect(model).toContain("{ name: 'tenant_confirmation_delivery' }")
    expect(migration).toContain("name: 'tenant_confirmation_delivery'")
  })
})
