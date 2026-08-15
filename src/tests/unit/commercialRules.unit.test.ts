import { describe, expect, it } from 'vitest'
import { calculateSubscriptionCharge } from '../../app/module/billing/pricing'
import { featureEnabled, trialEntitlements, wouldExceedEntitlementLimit } from '../../app/module/entitlement/entitlement.service'
import { permissionsForRole, roleHasPermission } from '../../app/middlewares/auth'
import { LocalizationService } from '../../app/module/localization/localization.service'


describe('commercial rules', () => {
  it('calculates server-owned BDT subscription pricing without VAT registration', () => {
    const charge = calculateSubscriptionCharge({ priceMonthly: 1490, priceYearly: 14900, billingCycle: 'monthly', tax: null })
    expect(charge.amount).toBe(1490)
    expect(charge.currency).toBe('BDT')
    expect(charge.taxSnapshot.vatAmount).toBe(0)
  })

  it('adds VAT only when registered pricing excludes VAT', () => {
    const charge = calculateSubscriptionCharge({ priceMonthly: 1000, priceYearly: 10000, billingCycle: 'monthly', tax: {
      invoiceEnabled: true, registrationStatus: 'registered', vatRate: 15, pricesIncludeVat: false,
    } })
    expect(charge.amount).toBe(1150)
    expect(charge.taxSnapshot.baseAmount).toBe(1000)
    expect(charge.taxSnapshot.vatAmount).toBe(150)
  })

  it('extracts VAT from VAT-inclusive prices without changing the checkout amount', () => {
    const charge = calculateSubscriptionCharge({ priceMonthly: 1150, priceYearly: 11500, billingCycle: 'monthly', tax: {
      invoiceEnabled: true, registrationStatus: 'registered', vatRate: 15, pricesIncludeVat: true,
    } })
    expect(charge.amount).toBe(1150)
    expect(charge.taxSnapshot.baseAmount).toBe(1000)
    expect(charge.taxSnapshot.vatAmount).toBe(150)
  })

  it('enforces plan limits without deleting existing data', () => {
    expect(wouldExceedEntitlementLimit(9, 10, 1)).toBe(false)
    expect(wouldExceedEntitlementLimit(10, 10, 1)).toBe(true)
    expect(trialEntitlements.maxProperties).toBe(10)
  })

  it('maps feature entitlements explicitly', () => {
    expect(featureEnabled({ hasCustomDomain: true }, 'customDomain')).toBe(true)
    expect(featureEnabled({ hasSmsAutomation: false }, 'smsAutomation')).toBe(false)
  })

  it('keeps publishing owner-controlled while preserving safe role defaults', () => {
    expect(roleHasPermission('agency_owner', 'billing.manage')).toBe(true)
    expect(roleHasPermission('agency_owner', 'properties.publish')).toBe(true)
    expect(roleHasPermission('agency_admin', 'properties.publish')).toBe(true)
    expect(roleHasPermission('agent', 'properties.publish')).toBe(false)
    expect(roleHasPermission('agent', 'billing.manage')).toBe(false)
    expect(roleHasPermission('agent', 'properties.delete')).toBe(false)
    expect(permissionsForRole('viewer')).toEqual(expect.arrayContaining(['properties.read', 'leads.read']))
    expect(permissionsForRole('agency_owner')).not.toEqual(expect.arrayContaining(['compliance.read', 'compliance.write']))
  })

  it('keeps Bangladesh property-area conversions deterministic', () => {
    expect(LocalizationService.convertArea(1, 'katha', 'sqft').value).toBe(720)
    expect(LocalizationService.convertArea(1, 'acre', 'decimal').value).toBe(100)
  })
})
