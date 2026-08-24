import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const quoteService = read('src/app/module/subscription/subscriptionQuote.service.ts')
const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const bkashService = read('src/app/module/bkashPayment/bkashPayment.service.ts')
const billingRoute = read('src/app/module/billing/billing.route.ts')
const benefitService = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')

const prorated = (current: number, target: number, remaining: number, total: number) =>
  Number((Math.max(0, target - current) * Math.max(0, Math.min(1, remaining / total))).toFixed(2))

describe('Phase 4 authoritative prorated subscription billing', () => {
  it('matches the Starter 500 -> Medium 1000 half-period example', () => {
    expect(prorated(500, 1000, 15, 30)).toBe(250)
  })

  it('uses exact period seconds rather than a hard-coded 30-day month', () => {
    expect(quoteService).toContain('remainingSeconds / periodTotalSeconds')
    expect(quoteService).toContain('currentPeriodEnd.getTime() - currentPeriodStart.getTime()')
    expect(quoteService).not.toContain('30 * 24 * 60 * 60')
  })

  it('exposes one authenticated authoritative quote endpoint', () => {
    expect(billingRoute).toContain("router.post('/quote'")
    expect(billingRoute).toContain("requirePermission('billing.manage')")
  })

  it('uses the same quote service for manual payment requests and bKash checkout', () => {
    expect(paymentService).toContain('SubscriptionQuoteService.quote')
    expect(bkashService).toContain('SubscriptionQuoteService.quote')
    expect(paymentService).toContain('quoteSnapshot')
    expect(bkashService).toContain('quoteSnapshot')
  })

  it('preserves the current renewal boundary for a paid mid-cycle upgrade', () => {
    expect(paymentService).toContain('midCycleImmediateChange && existingEnd')
    expect(paymentService).toContain('currentPeriodEnd: end')
    expect(bkashService).toContain('midCycleImmediateChange && currentPeriodEnd')
    expect(bkashService).toContain('currentPeriodEnd: periodEnd')
  })

  it('keeps full entitlements immediate while the upgrade itself is not a renewal', () => {
    expect(paymentService).toContain('reconcileOrganizationEntitlements')
    expect(bkashService).toContain('reconcileOrganizationEntitlements')
    expect(benefitService).toContain('if (current < previousEnd) return false')
  })

  it('keeps downgrade scheduling and lead-preservation reconciliation intact', () => {
    expect(paymentService).toContain('scheduleDowngradeOnOrganization')
    expect(bkashService).toContain('scheduleDowngradeOnOrganization')
    expect(paymentService).toContain('reconcileOrganizationEntitlements')
    expect(bkashService).toContain('reconcileOrganizationEntitlements')
  })

  it('rejects stale quote reuse instead of silently changing the amount', () => {
    expect(paymentService).toContain('This subscription quote has expired')
    expect(paymentService).toContain('quoteCalculatedAt')
    expect(paymentService).toContain('Payment amount does not match its subscription quote snapshot')
    expect(bkashService).toContain('bKash payment amount does not match its authoritative subscription quote')
  })
})
