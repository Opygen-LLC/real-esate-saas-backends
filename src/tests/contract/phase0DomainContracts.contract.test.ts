import { describe, expect, it } from 'vitest'
import { PropertyValidation } from '../../app/module/property/property.validation'
import { subscriptionPaymentInputSchema, subscriptionPaymentDecisionSchema } from '../../app/module/subscriptionPayment/subscriptionPayment.validation'
import { subscriptionChangeRequestInputSchema } from '../../app/module/subscriptionChangeRequest/subscriptionChangeRequest.validation'
import { PrivacyConsentService } from '../../app/module/privacy/privacyConsent.service'

const propertyBase = {
  title: 'Dhanmondi Apartment',
  propertyType: 'Apartment',
  listingType: 'ForSale',
  price: 12000000,
  currency: 'BDT',
  areaUnit: 'sqft',
  country: 'Bangladesh',
}

describe('Phase 0 domain contracts', () => {
  it('enforces a hard maximum of 20 property photos', () => {
    const images = Array.from({ length: 21 }, (_, index) => ({ url: `https://cdn.example.test/property-${index}.webp` }))
    expect(PropertyValidation.createPropertyZodSchema.safeParse({ body: { ...propertyBase, images } }).success).toBe(false)
    expect(PropertyValidation.createPropertyZodSchema.safeParse({ body: { ...propertyBase, images: images.slice(0, 20) } }).success).toBe(true)
  })

  it('accepts structured hosted media and permits only one hero item', () => {
    const baseMedia = {
      id: 'media-1',
      url: 'https://www.youtube.com/watch?v=abc123',
      provider: 'youtube',
      type: 'video',
      isHero: true,
    }
    expect(PropertyValidation.createPropertyZodSchema.safeParse({ body: { ...propertyBase, mediaLinks: [baseMedia] } }).success).toBe(true)
    expect(PropertyValidation.createPropertyZodSchema.safeParse({ body: { ...propertyBase, mediaLinks: [baseMedia, { ...baseMedia, id: 'media-2', url: 'https://vimeo.com/123', provider: 'vimeo' }] } }).success).toBe(false)
  })

  it('defines BDT-only manual subscription payment inputs and guarded decisions', () => {
    const payment = {
      organizationId: 'agency-001', planId: 'professional', planVersion: 2, billingCycle: 'monthly',
      amount: 1500, currency: 'BDT', method: 'bkash', reference: 'TRX-123', paidAt: new Date().toISOString(),
    }
    expect(subscriptionPaymentInputSchema.safeParse(payment).success).toBe(true)
    expect(subscriptionPaymentInputSchema.safeParse({ ...payment, currency: 'USD' }).success).toBe(false)
    expect(subscriptionPaymentDecisionSchema.safeParse({ status: 'rejected' }).success).toBe(false)
    expect(subscriptionPaymentDecisionSchema.safeParse({ status: 'rejected', reason: 'Reference could not be verified' }).success).toBe(true)
  })

  it('rejects a no-op subscription change request', () => {
    const request = {
      organizationId: 'agency-001', currentPlan: 'starter', currentPlanVersion: 1,
      requestedPlan: 'starter', requestedPlanVersion: 1, billingCycle: 'monthly', amount: 500,
      currency: 'BDT', requestedBy: 'user-1',
    }
    expect(subscriptionChangeRequestInputSchema.safeParse(request).success).toBe(false)
    expect(subscriptionChangeRequestInputSchema.safeParse({ ...request, requestedPlan: 'professional' }).success).toBe(true)
  })

  it('hashes public privacy subjects instead of storing a raw phone identifier', () => {
    const subject = PrivacyConsentService.publicSubjectId('+8801712345678')
    expect(subject).toMatch(/^public:[a-f0-9]{64}$/)
    expect(subject).not.toContain('01712345678')
  })
})
