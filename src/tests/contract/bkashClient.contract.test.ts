import { describe, expect, it } from 'vitest'
import { subscriptionPaymentDecisionSchema, subscriptionPaymentInputSchema } from '../../app/module/subscriptionPayment/subscriptionPayment.validation'
import { agencySubscriptionChangeRequestSchema } from '../../app/module/subscriptionChangeRequest/subscriptionChangeRequest.validation'

describe('manual subscription payment API contract', () => {
  it('keeps plan requests server-authoritative and limited to supported cycles', () => {
    expect(agencySubscriptionChangeRequestSchema.parse({ planId: 'starter', billingCycle: 'monthly' })).toEqual({ planId: 'starter', billingCycle: 'monthly' })
    expect(() => agencySubscriptionChangeRequestSchema.parse({ planId: 'trial', billingCycle: 'monthly' })).toThrow()
    expect(() => agencySubscriptionChangeRequestSchema.parse({ planId: 'starter', billingCycle: 'weekly' })).toThrow()
  })

  it('requires references for non-cash manual payments', () => {
    expect(subscriptionPaymentInputSchema.parse({ organizationId: 'org-123', planId: 'starter', method: 'cash' }).method).toBe('cash')
    expect(() => subscriptionPaymentInputSchema.parse({ organizationId: 'org-123', planId: 'starter', method: 'bank' })).toThrow(/reference/i)
    expect(subscriptionPaymentInputSchema.parse({ organizationId: 'org-123', planId: 'starter', method: 'bank', reference: 'BANK-123' }).reference).toBe('BANK-123')
  })

  it('requires a meaningful reason when rejecting a payment', () => {
    expect(subscriptionPaymentDecisionSchema.parse({ status: 'confirmed' }).status).toBe('confirmed')
    expect(() => subscriptionPaymentDecisionSchema.parse({ status: 'rejected', reason: 'bad' })).toThrow(/reason/i)
    expect(subscriptionPaymentDecisionSchema.parse({ status: 'rejected', reason: 'Reference could not be verified' }).status).toBe('rejected')
  })
})
