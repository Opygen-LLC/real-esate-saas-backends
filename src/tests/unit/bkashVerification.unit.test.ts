import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.resolve(relative), 'utf8')

describe('manual subscription invariants', () => {
  it('does not mount the legacy gateway route', () => {
    const billingRoute = read('src/app/module/billing/billing.route.ts')
    expect(billingRoute).not.toContain('/bkash')
    expect(billingRoute).toContain('/change-plan')
  })

  it('blocks direct paid-plan activation in platform admin service', () => {
    const service = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    expect(service).toMatch(/Paid plans are activated only by confirming a manual subscription payment/)
  })

  it('uses the subscription payment ledger as the revenue source', () => {
    const service = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    expect(service).toContain("$match: { status: 'confirmed' }")
    expect(service).toContain('SubscriptionPayment.aggregate')
  })
})
