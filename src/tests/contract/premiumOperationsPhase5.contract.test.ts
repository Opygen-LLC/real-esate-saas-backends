import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CURRENT_PLAN_CATALOG } from '../../app/module/subscriptionPlan/subscriptionPlan.catalog'
import { effectivePermissionsForUser, normalizeCustomPermissions, permissionsForRole } from '../../app/module/user/accessControl'
import { applyTenantEntitlementOverride, type EffectiveTenantLimits } from '../../app/module/tenantEntitlementOverride/tenantEntitlementOverride.resolver'
import type { ITenantEntitlementOverride } from '../../app/module/tenantEntitlementOverride/tenantEntitlementOverride.interface'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const premiumPermissionSet = [
  'customerFinance.read', 'customerFinance.manage', 'customerPayments.manage',
  'materials.read', 'materials.manage', 'inventory.adjust',
  'suppliers.read', 'suppliers.manage', 'supplierPayments.manage',
]

const baseLimits = (enabled: boolean): EffectiveTenantLimits => ({
  maxLeads: 100,
  maxProperties: 20,
  maxTeamMembers: 5,
  maxStorageMb: 1024,
  maxMonthlyVisitors: 10_000,
  hasCustomDomain: false,
  hasAdvancedAnalytics: false,
  hasWhatsAppIntegration: false,
  hasSmsAutomation: false,
  hasLeadAutomations: false,
  hasPremiumTemplates: false,
  hasAdvancedAccounting: false,
  hasCustomerFinance: enabled,
  hasMaterialsInventory: enabled,
  hasSupplierManagement: enabled,
})

const override = (features: ITenantEntitlementOverride['features']): ITenantEntitlementOverride => ({
  organizationId: 'org_test',
  version: 1,
  activeKey: 'org_test',
  status: 'active',
  resources: {},
  features,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  reason: 'Contract test',
  createdBy: 'super-admin:test',
})

describe('Premium Operations Phase 5 production contract', () => {
  it('keeps premium operations off on the first two plans and on for the current BDT 2,000 Agency plan', () => {
    expect(CURRENT_PLAN_CATALOG.starter.features.customerFinance).toBe(false)
    expect(CURRENT_PLAN_CATALOG.starter.features.materialsInventory).toBe(false)
    expect(CURRENT_PLAN_CATALOG.starter.features.supplierManagement).toBe(false)
    expect(CURRENT_PLAN_CATALOG.professional.features.customerFinance).toBe(false)
    expect(CURRENT_PLAN_CATALOG.professional.features.materialsInventory).toBe(false)
    expect(CURRENT_PLAN_CATALOG.professional.features.supplierManagement).toBe(false)
    expect(CURRENT_PLAN_CATALOG.agency.priceMonthly).toBe(2_000)
    expect(CURRENT_PLAN_CATALOG.agency.features.customerFinance).toBe(true)
    expect(CURRENT_PLAN_CATALOG.agency.features.materialsInventory).toBe(true)
    expect(CURRENT_PLAN_CATALOG.agency.features.supplierManagement).toBe(true)
  })

  it('supports super-admin enable/disable overrides independently from the underlying plan', () => {
    const enabled = applyTenantEntitlementOverride(baseLimits(false), override({
      customerFinance: true,
      materialsInventory: true,
      supplierManagement: true,
    }))
    expect(enabled.hasCustomerFinance).toBe(true)
    expect(enabled.hasMaterialsInventory).toBe(true)
    expect(enabled.hasSupplierManagement).toBe(true)

    const disabled = applyTenantEntitlementOverride(baseLimits(true), override({
      customerFinance: false,
      materialsInventory: false,
      supplierManagement: false,
    }))
    expect(disabled.hasCustomerFinance).toBe(false)
    expect(disabled.hasMaterialsInventory).toBe(false)
    expect(disabled.hasSupplierManagement).toBe(false)
  })

  it('gives owners/admins the small explicit premium permission set without granting it broadly to sales/staff', () => {
    for (const permission of premiumPermissionSet) {
      expect(permissionsForRole('agency_owner')).toContain(permission)
      expect(permissionsForRole('agency_admin')).toContain(permission)
    }
    expect(permissionsForRole('agent')).toContain('customerFinance.read')
    expect(permissionsForRole('agent')).toContain('customerFinance.manage')
    expect(permissionsForRole('agent')).not.toContain('customerPayments.manage')
    expect(permissionsForRole('agent')).not.toContain('inventory.adjust')
    expect(permissionsForRole('agent')).not.toContain('supplierPayments.manage')
    expect(permissionsForRole('staff')).toContain('customerFinance.read')
    expect(permissionsForRole('staff')).not.toContain('customerFinance.manage')
    expect(permissionsForRole('staff')).not.toContain('materials.manage')
    expect(permissionsForRole('viewer')).not.toContain('customerFinance.read')
  })

  it('supports an accounts-style custom role and preserves legacy material/supplier custom grants', () => {
    const accounts = effectivePermissionsForUser({
      userRole: 'staff',
      accessControl: { useRoleDefaults: false, permissions: ['customerPayments.manage', 'supplierPayments.manage', 'finance.read'] },
    })
    expect(accounts).toContain('customerPayments.manage')
    expect(accounts).toContain('customerFinance.read')
    expect(accounts).toContain('supplierPayments.manage')
    expect(accounts).toContain('suppliers.read')
    expect(accounts).not.toContain('materials.manage')

    const legacy = normalizeCustomPermissions(['materials.write', 'suppliers.write', 'suppliers.payments'])
    expect(legacy).toEqual(expect.arrayContaining(['materials.manage', 'inventory.adjust', 'suppliers.manage', 'supplierPayments.manage']))
  })

  it('enforces explicit permissions and feature entitlements on premium write paths', () => {
    const customerRoutes = read('src/app/module/customerFinance/customerFinance.route.ts')
    const materialRoutes = read('src/app/module/materialInventory/materialInventory.route.ts')
    const supplierRoutes = read('src/app/module/supplierManagement/supplierManagement.route.ts')
    expect(customerRoutes).toContain("requireEntitlement('CUSTOMER_FINANCE')")
    expect(customerRoutes).toContain("requirePermission('customerPayments.manage')")
    expect(materialRoutes).toContain("requireEntitlement('MATERIALS_INVENTORY')")
    expect(materialRoutes).toContain("requirePermission('inventory.adjust')")
    expect(supplierRoutes).toContain("requireEntitlement('SUPPLIER_MANAGEMENT')")
    expect(supplierRoutes).toContain("requirePermission('supplierPayments.manage')")
  })

  it('keeps tenant IDs and same-tenant relation validation in every Phase 2-4 operational model/service', () => {
    const files = [
      'src/app/module/customerFinance/saleBooking.model.ts',
      'src/app/module/customerFinance/installment.model.ts',
      'src/app/module/materialInventory/material.model.ts',
      'src/app/module/materialInventory/materialRequirement.model.ts',
      'src/app/module/materialInventory/stockMovement.model.ts',
      'src/app/module/supplierManagement/materialPurchase.model.ts',
      'src/app/module/finance/finance.model.ts',
    ]
    for (const file of files) expect(read(file)).toContain('organizationId')
    expect(read('src/app/module/customerFinance/customerFinance.service.ts')).toContain('organizationId')
    expect(read('src/app/module/materialInventory/materialInventory.service.ts')).toContain('organizationId')
    expect(read('src/app/module/supplierManagement/supplierManagement.service.ts')).toContain('organizationId')
  })

  it('uses durable idempotency for money and stock mutations and prevents double booking', () => {
    expect(read('src/app/module/finance/finance.service.ts')).toContain('idempotencyKey')
    expect(read('src/app/module/materialInventory/stockMovement.model.ts')).toMatch(/idempotencyKey[\s\S]*unique:\s*true/)
    expect(read('src/app/module/supplierManagement/materialPurchaseReceipt.model.ts')).toMatch(/idempotencyKey[\s\S]*unique:\s*true/)
    expect(read('src/app/module/supplierManagement/supplierManagement.service.ts')).toContain('idempotencyKey')
    expect(read('src/app/module/supplierManagement/supplierManagement.service.ts')).toContain('paymentMutationVersion')
    expect(read('src/app/module/customerFinance/saleBooking.model.ts')).toMatch(/activePropertyKey[\s\S]*unique:\s*true/)
  })

  it('retains posted financial history and exposes controlled reversal/cancellation instead of delete', () => {
    const finance = read('src/app/module/finance/finance.service.ts')
    const customerRoutes = read('src/app/module/customerFinance/customerFinance.route.ts')
    const supplierRoutes = read('src/app/module/supplierManagement/supplierManagement.route.ts')
    expect(finance).toContain('voidInvoicePayment')
    expect(finance).toContain("payment.status = 'voided'")
    expect(customerRoutes).toContain('/payments/:paymentId/void')
    expect(supplierRoutes).toContain('/payments/:paymentId/void')
    expect(supplierRoutes).toContain('/purchases/:purchaseId/cancel')
  })

  it('uses the existing Operations Queue for premium reminders and rechecks state before delivery', () => {
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const reminder = read('src/app/module/operationsQueue/premiumOperationsReminder.service.ts')
    expect(queue).toContain('PremiumOperationsReminderService')
    expect(reminder).toContain('low_stock_reminder')
    expect(reminder).toContain('material_requirement_reminder')
    expect(reminder).toContain('supplier_payment_due')
    expect(reminder).toContain('featureEnabled')
    expect(reminder).toContain('effectivePermissionsForUser')
    expect(reminder).toContain('outstandingMinor')
  })

  it('audits override changes, expires overrides, and preserves premium records on downgrade/migration', () => {
    const overrides = read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts')
    expect(overrides).toContain('subscription.tenant_entitlement_override_applied')
    expect(overrides).toContain('subscription.tenant_entitlement_override_revoked')
    expect(overrides).toContain('subscription.tenant_entitlement_override_expired')
    expect(read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.resolver.ts')).toContain('expiresAt: { $gt: now }')
    const migration = read('src/app/db/migratePremiumOperationsSecurityPhase5.ts')
    expect(migration).toContain('destructiveDataChanges: false')
    expect(migration).not.toMatch(/deleteMany|dropCollection|dropDatabase/)
  })
})
