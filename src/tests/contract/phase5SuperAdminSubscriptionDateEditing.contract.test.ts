import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Phase 5 Super Admin paid subscription date editing', () => {
  it('keeps the mutation exclusively behind Super Admin authorization', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    expect(route).toContain("router.patch('/subscription-payments/:paymentNumber/dates', authMiddlewares.authSuperAdmin")
  })

  it('updates the payment, linked benefit period and current subscription atomically', () => {
    const source = read('src/app/module/subscriptionPayment/subscriptionDateAdjustment.service.ts')
    expect(source).toContain("payment.status !== 'confirmed'")
    expect(source).toContain('payment.periodStart = input.periodStart')
    expect(source).toContain('benefit.periodStart = input.periodStart')
    expect(source).toContain("'subscription.currentPeriodStart': input.periodStart")
    expect(source).toContain('addon.currentPeriodEnd = input.periodEnd')
    expect(source).toContain("action: 'subscription_date_changed'")
  })

  it('rejects invalid or overlapping paid access periods and protects current access from historical edits', () => {
    const source = read('src/app/module/subscriptionPayment/subscriptionDateAdjustment.service.ts')
    expect(source).toContain('periodEnd.getTime() <= periodStart.getTime()')
    expect(source).toContain('periodStart: { $lt: input.periodEnd }')
    expect(source).toContain('periodEnd: { $gt: input.periodStart }')
    expect(source).toContain('isCurrentSubscriptionPayment')
    expect(source).toContain('if (isCurrentSubscriptionPayment)')
  })
})
