import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let SubscriptionPlan: any
let SubscriptionBenefitPeriod: any
let Lead: any
let LeadEntitlementService: any
let LeadService: any
let readLeadListPage: any
const organizationId = 'org_subscription_release_security'

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

suite('locked Lead server-side security release', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ SubscriptionPlan } = await import('../../app/module/subscriptionPlan/subscriptionPlan.model'))
    ;({ SubscriptionBenefitPeriod } = await import('../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'))
    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ LeadEntitlementService } = await import('../../app/module/lead/leadEntitlement.service'))
    ;({ LeadService } = await import('../../app/module/lead/lead.service'))
    ;({ readLeadListPage } = await import('../../app/module/crm/crmListReadModel.service'))
  }, 20_000)

  beforeEach(async () => {
    await mongoose.connection.dropDatabase()
    await SubscriptionPlan.create({
      planId: 'starter', version: 6, name: 'Starter', priceMonthly: 500, priceYearly: 5000, currency: 'BDT', description: '', features: [],
      maxAgents: 3, maxProperties: 10, maxLeads: 1, leadAllowanceModel: 'active_capacity', baseMonthlyLeadAllowance: 1,
      renewalLeadBonus: 50, renewalBonusEnabled: true, maxRenewalLeadBonus: 0, continuityGraceDays: 3,
      hasCustomDomain: false, hasAdvancedAnalytics: false, hasWhatsAppIntegration: false, hasLeadAutomations: false,
      hasSmsAutomation: false, hasPremiumTemplates: false, maxStorageMb: 1024, maxMonthlyVisitors: 10000,
      isActive: true, isCurrent: true, effectiveFrom: new Date('2026-01-01T00:00:00Z'), grandfatherExisting: true,
    })
    await Organization.create({
      organizationId, agencyName: 'Security Realty', email: 'security@example.test', phone: '+8801733333333', sub_domain: 'security-realty',
      subscription: { plan: 'starter', planVersion: 6, status: 'active', maxProperties: 10, maxAgents: 3, currentPeriodEnd: new Date(Date.now() + 86400000), source: 'manual_payment' },
    })
    await SubscriptionBenefitPeriod.create({
      organizationId, paymentSource: 'manual_payment', paymentNumber: 'REL-SEC-1', planId: 'starter', planVersion: 6, billingCycle: 'monthly',
      periodStart: new Date(Date.now() - 3600000), periodEnd: new Date(Date.now() + 86400000), renewalStreak: 1,
      baseLeadAllowance: 1, bonusLeadAllowance: 0, totalLeadAllowance: 1, usedLeadAllowance: 0,
      leadAllowanceModel: 'active_capacity', renewalBonusEnabled: true, renewalLeadBonus: 50, maxRenewalLeadBonus: 0, continuityGraceDays: 3,
    })
    await Lead.insertMany([
      {
        organizationId, name: 'Older Locked Lead', phone: '+8801700000001', normalizedPhone: '+8801700000001',
        email: 'older-secret@example.test', normalizedEmail: 'older-secret@example.test', leadStatus: 'New', isLocked: false,
        createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        organizationId, name: 'Newest Accessible Lead', phone: '+8801700000002', normalizedPhone: '+8801700000002',
        email: 'newest@example.test', normalizedEmail: 'newest@example.test', leadStatus: 'New', isLocked: false,
        createdAt: new Date('2026-01-02T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ])
    await LeadEntitlementService.ensureCurrentLeadCapacity(organizationId)
  })

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('returns 402 PLAN_UPGRADE_REQUIRED for direct detail/mutation access to the locked record', async () => {
    const locked: any = await Lead.findOne({ organizationId, isLocked: true, lockReason: 'subscription_limit' }).lean()
    expect(locked).toBeTruthy()
    await expect(LeadService.getLeadById(organizationId, String(locked._id))).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
    await expect(LeadService.updateLead(organizationId, String(locked._id), { name: 'Should not update' })).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
    await expect(LeadService.updateLeadStatus(organizationId, String(locked._id), 'Contacted')).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
    await expect(LeadService.deleteLead(organizationId, String(locked._id))).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
    expect(await Lead.countDocuments({ organizationId })).toBe(2)
  })

  it('redacts locked phone/email before the list response leaves MongoDB', async () => {
    const page = await readLeadListPage({ match: { organizationId }, skip: 0, limit: 10, sortBy: 'createdAt', sortOrder: -1 })
    expect(page.total).toBe(2)
    const locked: any = page.rows.find((row: any) => row.isLocked === true)
    expect(locked).toBeTruthy()
    expect(locked.phone).toBe('••••••••••')
    expect(locked.email).toBe('••••••••')
    expect(JSON.stringify(locked)).not.toContain('older-secret@example.test')
    expect(JSON.stringify(locked)).not.toContain('+8801700000001')
  })

  it('blocks both CSV and XLSX exports when the requested scope includes a locked Lead', async () => {
    await expect(LeadService.exportCsv(organizationId, {})).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
    await expect(LeadService.exportXlsx(organizationId, {})).rejects.toMatchObject({ statusCode: 402, code: 'PLAN_UPGRADE_REQUIRED' })
  })

  it('keeps all listed Lead/activity routes behind the canonical accessibility guard', () => {
    const lead = source('src/app/module/lead/lead.service.ts')
    const lifecycle = source('src/app/module/lead/leadLifecycle.service.ts')
    const activity = source('src/app/module/activity/activity.service.ts')
    const routes = source('src/app/module/lead/lead.route.ts')
    expect((lead.match(/assertLeadAccessible/g) || []).length).toBeGreaterThanOrEqual(9)
    expect(lifecycle).toContain('assertLeadAccessible')
    expect((activity.match(/assertLeadAccessible/g) || []).length).toBeGreaterThanOrEqual(4)
    for (const route of [
      "router.get('/:id/history'", "router.post('/:id/notes'", "router.get('/:id'", "router.patch('/:id'",
      "router.patch('/:id/status'", "router.patch('/:id/assign'", "router.patch('/:id/follow-up'",
      "router.post('/:id/reengage'", "router.post('/:id/response'", "router.delete('/:id'",
    ]) expect(routes).toContain(route)
  })
})
