import { describe, expect, it } from 'vitest'
import { TenantAccessService } from '../../app/module/tenantAccess/tenantAccess.service'

const organization = (overrides: Record<string, unknown> = {}) => ({
  organizationId: 'org_access_test',
  isBlocked: false,
  platformAccess: { status: 'active' },
  websiteStatus: 'published',
  subscription: {
    plan: 'starter',
    planVersion: 6,
    status: 'active',
    currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    gracePeriodEnd: null,
  },
  ...overrides,
})

describe('TenantAccessService.evaluateOrganization', () => {
  it('allows an active published tenant', () => {
    const access = TenantAccessService.evaluateOrganization(organization(), new Date('2026-08-26T00:00:00.000Z'))
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(true)
    expect(access.backgroundBusinessWorkAllowed).toBe(true)
    expect(access.reason).toBe('ACTIVE')
    expect(TenantAccessService.toPublicAccess(access)).toEqual({ allowed: true, reason: 'ACTIVE' })
  })

  it('keeps workspace access while an active website is not published', () => {
    const access = TenantAccessService.evaluateOrganization(organization({ websiteStatus: 'provisioned' }))
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.publicWritesAllowed).toBe(false)
    expect(access.reason).toBe('WEBSITE_NOT_PUBLISHED')
  })

  it('locks an expired trial but leaves subscription recovery available', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      subscription: {
        plan: 'trial',
        planVersion: 1,
        status: 'expired',
        currentPeriodEnd: new Date('2026-08-25T00:00:00.000Z'),
        gracePeriodEnd: null,
      },
    }))
    expect(access.workspaceAllowed).toBe(false)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.reason).toBe('TRIAL_EXPIRED')
    expect(access.recoveryAllowed).toBe(true)
  })

  it('gives platform suspension precedence over an otherwise active subscription', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      isBlocked: true,
      platformAccess: { status: 'suspended' },
    }))
    expect(access.workspaceAllowed).toBe(false)
    expect(access.reason).toBe('PLATFORM_SUSPENDED')
    expect(access.recoveryAllowed).toBe(false)
  })


  it('locks an expired paid plan and keeps billing recovery available', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      subscription: {
        plan: 'professional',
        planVersion: 4,
        status: 'expired',
        currentPeriodEnd: new Date('2026-08-25T00:00:00.000Z'),
        gracePeriodEnd: null,
      },
    }))
    expect(access.workspaceAllowed).toBe(false)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.backgroundBusinessWorkAllowed).toBe(false)
    expect(access.reason).toBe('SUBSCRIPTION_EXPIRED')
    expect(access.recoveryAllowed).toBe(true)
  })

  it('keeps platform suspension authoritative after a paid subscription becomes active again', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      isBlocked: true,
      platformAccess: { status: 'suspended' },
      subscription: {
        plan: 'professional',
        planVersion: 4,
        status: 'active',
        currentPeriodEnd: new Date('2026-09-25T00:00:00.000Z'),
        gracePeriodEnd: null,
      },
    }))
    expect(access.subscriptionStatus).toBe('active')
    expect(access.workspaceAllowed).toBe(false)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.reason).toBe('PLATFORM_SUSPENDED')
    expect(access.recoveryAllowed).toBe(false)
  })

  it('never republishes a provisioned website when subscription access is restored', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      websiteStatus: 'provisioned',
      subscription: {
        plan: 'professional',
        planVersion: 4,
        status: 'active',
        currentPeriodEnd: new Date('2026-09-25T00:00:00.000Z'),
        gracePeriodEnd: null,
      },
    }))
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.websiteStatus).toBe('provisioned')
    expect(access.reason).toBe('WEBSITE_NOT_PUBLISHED')
  })

  it('fails closed for an inconsistent legacy isBlocked row', () => {
    const access = TenantAccessService.evaluateOrganization(organization({
      isBlocked: true,
      platformAccess: { status: 'active' },
    }))
    expect(access.platformStatus).toBe('suspended')
    expect(access.workspaceAllowed).toBe(false)
  })
})
