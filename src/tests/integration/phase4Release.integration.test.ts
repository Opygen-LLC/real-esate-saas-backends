import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

let mongoose: typeof import('mongoose')
let server: Server | undefined
let baseUrl = ''
let organizationId = ''
let foreignOrganizationId = ''
let actor: any
let FinanceService: any
let FinanceAccountingService: any
let FinanceOperationsService: any
let FinanceInvoice: any
let FinanceTaxCode: any
let FinanceAccountingSettings: any
let AuditEvent: any
let OperationsJob: any
let TransactionalOutbox: any
let AuditServiceModule: any
let User: any
let Organization: any
let Property: any
let Banner: any
let Section: any
let LandingPage: any
let vat15: any
let ownProperty: any
let foreignProperty: any

const invoicePayload = (overrides: Record<string, unknown> = {}) => ({
  clientName: 'Phase Four Release Client',
  clientPhone: '+8801712345678',
  clientEmail: 'release-client@example.test',
  issueDate: new Date('2026-09-09T00:00:00.000Z'),
  dueDate: new Date('2026-09-16T00:00:00.000Z'),
  lineItems: [{ description: 'Agency service', quantity: 1, unitPrice: 10000 }],
  discount: 0,
  taxCodeId: null,
  status: 'draft',
  notes: 'Phase 4 release regression',
  ...overrides,
})

suite('Phase 4 production release regression', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.EMAIL_DEV_MODE = 'true'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()

    const hello = await mongoose.connection.db!.admin().command({ hello: 1 })
    expect(Boolean(hello.setName || hello.msg === 'isdbgrid'), 'TEST_DATABASE_URL must be a replica set or mongos').toBe(true)

    ;({ FinanceService } = await import('../../app/module/finance/finance.service'))
    ;({ FinanceAccountingService } = await import('../../app/module/finance/financeAccounting.service'))
    ;({ FinanceOperationsService } = await import('../../app/module/finance/financeOperations.service'))
    ;({ FinanceInvoice } = await import('../../app/module/finance/finance.model'))
    ;({ FinanceTaxCode } = await import('../../app/module/finance/financeOperations.model'))
    ;({ FinanceAccountingSettings } = await import('../../app/module/finance/financeAccountingSettings.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ OperationsJob } = await import('../../app/module/operationsQueue/operationsJob.model'))
    ;({ TransactionalOutbox } = await import('../../app/module/domainEvent/transactionalOutbox.service'))
    AuditServiceModule = await import('../../app/module/audit/audit.service')
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ Banner } = await import('../../app/module/banner/banner.model'))
    ;({ Section } = await import('../../app/module/section/section.model'))
    ;({ LandingPage } = await import('../../app/module/landingPage/landingPage.model'))

    organizationId = `phase4-release-${new mongoose.Types.ObjectId().toHexString()}`
    foreignOrganizationId = `phase4-foreign-${new mongoose.Types.ObjectId().toHexString()}`
    const owner = await User.create({
      name: 'Phase Four Owner', email: `phase4-${Date.now()}@example.test`, phoneNumber: '+8801811111111',
      password: 'unused-test-password', organizationId, userRole: 'agency_owner', status: 'active', isVerified: true,
    })
    await Organization.create({
      organizationId, agencyName: 'Phase Four Realty', agencyType: 'residential', ownerId: owner._id,
      email: 'office@example.test', phone: '+8801811111111', sub_domain: `phase4-${Date.now()}`,
      websiteStatus: 'published', subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 },
    })
    actor = { id: owner._id.toString(), role: 'agency_owner', requestId: 'phase4-release', ip: '127.0.0.1' }

    await FinanceAccountingService.initialize(organizationId, actor)
    await FinanceOperationsService.initializeOperations(organizationId, actor)
    vat15 = await FinanceOperationsService.createTaxCode(organizationId, actor, {
      code: 'VAT15', name: 'VAT 15%', type: 'VAT', direction: 'OUTPUT', ratePercent: 15, status: 'ACTIVE',
    })

    ownProperty = await Property.create({
      organizationId, title: 'Phase Four Residence', slug: `phase-four-residence-${Date.now()}`,
      propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 12000000,
      currency: 'BDT', areaUnit: 'sqft', address: 'Dhaka', city: 'Dhaka', images: [], amenities: [], views: 0,
    })
    foreignProperty = await Property.create({
      organizationId: foreignOrganizationId, title: 'Foreign Residence', slug: `foreign-residence-${Date.now()}`,
      propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000,
      currency: 'BDT', areaUnit: 'sqft', address: 'Dhaka', city: 'Dhaka', images: [], amenities: [], views: 0,
    })

    const app = (await import('../../app')).default
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server!.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to bind Phase 4 test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('reports /ready only when transaction-capable MongoDB is available', async () => {
    const response = await fetch(`${baseUrl}/ready`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ready' })
  })

  it('creates no-tax invoices with Advanced Accounting active in both draft and sent states', async () => {
    const draft = await FinanceService.createInvoice(organizationId, actor, invoicePayload({ status: 'draft', taxCodeId: null }))
    expect(draft.status).toBe('draft')
    expect(draft.taxCodeId).toBeNull()
    expect(draft.revenueJournalId || null).toBeNull()

    const sent = await FinanceService.createInvoice(organizationId, actor, invoicePayload({ status: 'sent', taxCodeId: null }))
    expect(sent.status).toBe('sent')
    expect(sent.taxCodeId).toBeNull()
    expect(sent.revenueJournalId).toBeTruthy()
  })

  it('calculates valid output tax after discount and rejects invalid/cross-tenant tax codes', async () => {
    const taxed = await FinanceService.createInvoice(organizationId, actor, invoicePayload({
      status: 'sent', taxCodeId: String(vat15._id), discount: 1000,
    }))
    expect(taxed.subtotal).toBe(10000)
    expect(taxed.discount).toBe(1000)
    expect(taxed.taxAmount).toBe(1350)
    expect(taxed.total).toBe(10350)
    expect(taxed.revenueJournalId).toBeTruthy()

    const foreignTax = await FinanceTaxCode.create({
      organizationId: foreignOrganizationId, code: 'FOREIGN15', name: 'Foreign VAT', type: 'VAT', direction: 'OUTPUT',
      rateBasisPoints: 1500, status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId(actor.id),
    })
    await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({ taxCodeId: String(foreignTax._id) })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { taxCodeId: ['Tax code is inactive, invalid, or not an output tax code'] } })
  })

  it('returns exact field errors for line-item, discount, due-date and foreign-property failures', async () => {
    await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({
      lineItems: [{ description: 'Invalid quantity', quantity: 0, unitPrice: 100 }],
    }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { 'lineItems.0.quantity': ['Quantity must be greater than zero'] } })

    await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({ discount: 20000 })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { discount: ['Discount cannot exceed subtotal'] } })

    await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({ dueDate: new Date('2026-09-01T00:00:00.000Z') })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { dueDate: ['Due date cannot be before the issue date'] } })

    await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({ propertyId: String(foreignProperty._id) })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: { propertyId: ['This property does not belong to your organization.'] } })

    const linked = await FinanceService.createInvoice(organizationId, actor, invoicePayload({ propertyId: String(ownProperty._id) }))
    expect(String(linked.propertyId?._id)).toBe(String(ownProperty._id))
  })

  it('returns FINANCE_ACCOUNT_MAPPING_REQUIRED and rolls the invoice back when sent-posting configuration is incomplete', async () => {
    const settings = await FinanceAccountingSettings.findOne({ organizationId }).lean()
    const originalRevenue = settings?.defaultAccounts?.commissionRevenue
    expect(originalRevenue).toBeTruthy()
    await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { 'defaultAccounts.commissionRevenue': null } })
    const key = `phase4-missing-mapping-${Date.now()}`
    try {
      await expect(FinanceService.createInvoice(organizationId, actor, invoicePayload({ status: 'sent' }), { idempotencyKey: key }))
        .rejects.toMatchObject({ statusCode: 409, code: 'FINANCE_ACCOUNT_MAPPING_REQUIRED' })
      expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(0)
    } finally {
      await FinanceAccountingSettings.updateOne({ organizationId }, { $set: { 'defaultAccounts.commissionRevenue': originalRevenue } })
    }
  })

  it('replays duplicate/network-retry creation idempotently without duplicating invoice, audit or outbox', async () => {
    const key = `phase4-retry-${Date.now()}`
    const payload = invoicePayload({ status: 'draft', notes: 'lost response replay' })
    const first = await FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })
    const retry = await FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })
    expect(String(retry._id)).toBe(String(first._id))
    expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(1)
    expect(await AuditEvent.countDocuments({ organizationId, entityId: String(first._id), action: 'finance.invoice.created' })).toBe(1)
    expect(await OperationsJob.countDocuments({ organizationId, type: 'domain_event_publish', 'payload.event.aggregateId': String(first._id) })).toBe(1)

    await expect(FinanceService.createInvoice(organizationId, actor, { ...payload, notes: 'different body' }, { idempotencyKey: key }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVOICE_IDEMPOTENCY_KEY_REUSED' })
  })

  it('rolls back invoice and outbox atomically when audit persistence fails, then allows a safe retry', async () => {
    const key = `phase4-audit-failure-${Date.now()}`
    const payload = invoicePayload({ status: 'draft', notes: 'forced audit failure' })
    const beforeOutboxCount = await OperationsJob.countDocuments({ organizationId, type: 'domain_event_publish' })
    const spy = vi.spyOn(AuditServiceModule, 'writeAudit').mockRejectedValueOnce(new Error('forced phase4 audit failure'))
    await expect(FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })).rejects.toThrow(/forced phase4 audit failure/i)
    spy.mockRestore()

    expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(0)
    expect(await OperationsJob.countDocuments({ organizationId, type: 'domain_event_publish' })).toBe(beforeOutboxCount)

    const retried = await FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })
    expect(retried._id).toBeTruthy()
    expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(1)
  })

  it('rolls back invoice and audit atomically when durable outbox persistence fails, then allows a safe retry', async () => {
    const key = `phase4-outbox-failure-${Date.now()}`
    const payload = invoicePayload({ status: 'draft', notes: 'forced outbox failure' })
    const beforeAuditCount = await AuditEvent.countDocuments({ organizationId, action: 'finance.invoice.created' })
    const spy = vi.spyOn(TransactionalOutbox, 'emit').mockRejectedValueOnce(new Error('forced phase4 outbox failure'))
    await expect(FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })).rejects.toThrow(/forced phase4 outbox failure/i)
    spy.mockRestore()

    expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(0)
    expect(await AuditEvent.countDocuments({ organizationId, action: 'finance.invoice.created' })).toBe(beforeAuditCount)

    const retried = await FinanceService.createInvoice(organizationId, actor, payload, { idempotencyKey: key })
    expect(retried._id).toBeTruthy()
    expect(await FinanceInvoice.countDocuments({ organizationId, creationIdempotencyKey: key })).toBe(1)
  })

  it('does not expose inactive Banner, Section or Landing Page records through public HTTP endpoints', async () => {
    await Banner.create([
      { organizationId, title: 'Active banner', image: 'https://images.example.test/active.jpg', status: true },
      { organizationId, title: 'Hidden banner', image: 'https://images.example.test/hidden.jpg', status: false },
    ])
    await Section.create([
      { organizationId, name: 'active', type: 'PropertyGrid', title: 'Active section', status: true, order: 1 },
      { organizationId, name: 'hidden', type: 'PropertyGrid', title: 'Hidden section', status: false, order: 2 },
    ])
    await LandingPage.create([
      { organizationId, title: 'Active page', slug: 'active-page', content: '<p>Active</p>', status: true },
      { organizationId, title: 'Hidden page', slug: 'hidden-page', content: '<p>Hidden</p>', status: false },
    ])

    for (const [path, activeText, hiddenText] of [
      [`/api/v1/banner/public/${organizationId}`, 'Active banner', 'Hidden banner'],
      [`/api/v1/section/public/${organizationId}`, 'Active section', 'Hidden section'],
      [`/api/v1/landing-page/public/${organizationId}`, 'Active page', 'Hidden page'],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`)
      expect(response.status).toBe(200)
      const body: any = await response.json()
      expect(JSON.stringify(body.data)).toContain(activeText)
      expect(JSON.stringify(body.data)).not.toContain(hiddenText)
      expect(JSON.stringify(body.data)).not.toContain('organizationId')
    }
  })
})
