import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let FinanceService: any
let FinanceInvoice: any
let FinanceTransaction: any
let AuditEvent: any
let User: any
let Organization: any
let Property: any
let organizationId = ''
let actor: any

const invoicePayload = (status: 'draft' | 'sent' = 'draft') => ({
  clientName: 'Phase Five Client',
  clientPhone: '+8801712345678',
  clientEmail: 'client@phase5.test',
  issueDate: new Date(),
  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  lineItems: [{ description: 'Property advisory', quantity: 1, unitPrice: 10000, amount: 10000 }],
  discount: 0,
  status,
  notes: 'Initial invoice',
})

suite('phase 5 finance billing lifecycle', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ FinanceService } = await import('../../app/module/finance/finance.service'))
    ;({ FinanceInvoice, FinanceTransaction } = await import('../../app/module/finance/finance.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))

    organizationId = 'org_phase5_finance'
    const owner = await User.create({
      name: 'Phase Five Owner', email: 'owner@phase5.test', phoneNumber: '+8801811111111', password: 'unused-test-password',
      organizationId, userRole: 'agency_owner', status: 'active', isVerified: true,
    })
    await Organization.create({
      organizationId, agencyName: 'Phase Five Realty', agencyType: 'residential', ownerId: owner._id,
      email: 'office@phase5.test', phone: '+8801811111111', sub_domain: 'phase5-finance', websiteStatus: 'published',
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 },
    })
    actor = { id: owner._id.toString(), role: 'agency_owner', requestId: 'phase5-integration', ip: '127.0.0.1' }
  }, 20_000)

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('edits and soft-archives an unpaid draft while retaining an audit trail', async () => {
    const created = await FinanceService.createInvoice(organizationId, actor, invoicePayload('draft'))
    const updated = await FinanceService.updateInvoice(organizationId, actor, String(created._id), {
      clientName: 'Updated Phase Five Client',
      lineItems: [{ description: 'Updated advisory', quantity: 2, unitPrice: 6000, amount: 12000 }],
    })
    expect(updated.clientName).toBe('Updated Phase Five Client')
    expect(updated.total).toBe(12000)

    await FinanceService.archiveDraftInvoice(organizationId, actor, String(created._id), 'Duplicate draft')
    const archived = await FinanceInvoice.findById(created._id).lean()
    expect(archived?.archivedAt).toBeTruthy()
    await expect(FinanceService.getInvoiceById(organizationId, String(created._id))).rejects.toMatchObject({ statusCode: 404 })

    const auditActions = await AuditEvent.find({ organizationId, entityId: String(created._id) }).distinct('action')
    expect(auditActions).toContain('finance.invoice.created')
    expect(auditActions).toContain('finance.invoice.updated')
    expect(auditActions).toContain('finance.invoice.archived')
  })

  it('voids an unpaid sent invoice but refuses to void a draft', async () => {
    const draft = await FinanceService.createInvoice(organizationId, actor, invoicePayload('draft'))
    await expect(FinanceService.voidInvoice(organizationId, actor, String(draft._id), 'No longer required')).rejects.toMatchObject({ statusCode: 409 })

    const sent = await FinanceService.createInvoice(organizationId, actor, invoicePayload('sent'))
    const voided = await FinanceService.voidInvoice(organizationId, actor, String(sent._id), 'Client cancelled the transaction')
    expect(voided.status).toBe('cancelled')
    expect(voided.cancelReason).toBe('Client cancelled the transaction')
    const event = await AuditEvent.findOne({ organizationId, entityId: String(sent._id), action: 'finance.invoice.voided' }).lean()
    expect(event?.reason).toBe('Client cancelled the transaction')
  })

  it('records append-only payment history and locks paid financial fields', async () => {
    const sent = await FinanceService.createInvoice(organizationId, actor, invoicePayload('sent'))
    const paid = await FinanceService.recordInvoicePayment(organizationId, actor, String(sent._id), {
      amount: 10000,
      paidAt: new Date(),
      paymentMethod: 'bank',
      reference: 'BANK-PHASE5-001',
      notes: 'Verified bank transfer',
    })
    expect(paid.status).toBe('paid')
    expect(paid.paidAmount).toBe(10000)
    expect(paid.payments).toHaveLength(1)
    expect(paid.payments[0].reference).toBe('BANK-PHASE5-001')
    expect(await FinanceTransaction.countDocuments({ organizationId, sourceType: 'invoice_payment', sourceId: sent._id })).toBe(1)

    await expect(FinanceService.updateInvoice(organizationId, actor, String(sent._id), {
      discount: 500,
    })).rejects.toMatchObject({ statusCode: 409 })
    await expect(FinanceService.voidInvoice(organizationId, actor, String(sent._id), 'Attempt after payment')).rejects.toMatchObject({ statusCode: 409 })
    const metadataOnly = await FinanceService.updateInvoice(organizationId, actor, String(sent._id), {
      clientEmail: 'updated-client@phase5.test',
      notes: 'Metadata correction only',
    })
    expect(metadataOnly.clientEmail).toBe('updated-client@phase5.test')
    expect(metadataOnly.total).toBe(10000)
    expect(metadataOnly.payments).toHaveLength(1)

    const paymentAudit = await AuditEvent.findOne({ organizationId, entityId: String(sent._id), action: 'finance.invoice.payment_recorded' }).lean()
    expect(paymentAudit?.metadata?.reference).toBe('BANK-PHASE5-001')

    const deleted = await FinanceService.archiveDraftInvoice(organizationId, actor, String(sent._id), 'Cleanup paid invoice')
    expect(deleted.archivedAt).toBeTruthy()
    expect((await FinanceInvoice.findById(sent._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceTransaction.findOne({ organizationId, sourceType: 'invoice_payment', sourceId: sent._id }).lean())?.deletedAt).toBeTruthy()
  })
  it('links only same-organization properties and carries property context into payments and audit history', async () => {
    const ownProperty = await Property.create({
      organizationId,
      title: 'Gulshan Lake Residence',
      slug: 'gulshan-lake-residence',
      propertyType: 'Apartment',
      listingType: 'ForSale',
      status: 'Available',
      price: 32000000,
      currency: 'BDT',
      areaUnit: 'sqft',
      address: 'Road 52, Gulshan 2',
      city: 'Dhaka',
      images: [],
      amenities: [],
      views: 0,
    })
    const foreignProperty = await Property.create({
      organizationId: 'org_foreign_finance',
      title: 'Foreign Property',
      slug: 'foreign-property',
      propertyType: 'Apartment',
      listingType: 'ForSale',
      status: 'Available',
      price: 1000000,
      currency: 'BDT',
      areaUnit: 'sqft',
      images: [],
      amenities: [],
      views: 0,
    })

    await expect(FinanceService.createInvoice(organizationId, actor, {
      ...invoicePayload('sent'),
      propertyId: String(foreignProperty._id),
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      fieldErrors: { propertyId: ['This property does not belong to your organization.'] },
    })

    const linked = await FinanceService.createInvoice(organizationId, actor, {
      ...invoicePayload('sent'),
      propertyId: String(ownProperty._id),
    })
    expect(linked.propertyId?._id?.toString()).toBe(String(ownProperty._id))
    expect(linked.propertyId?.title).toBe('Gulshan Lake Residence')
    expect(linked.propertyId?.slug).toBe('gulshan-lake-residence')

    await FinanceService.recordInvoicePayment(organizationId, actor, String(linked._id), {
      amount: 10000,
      paidAt: new Date(),
      paymentMethod: 'bank',
      reference: 'PROPERTY-LINK-PAYMENT',
    })
    const paymentTransaction = await FinanceTransaction.findOne({ organizationId, sourceType: 'invoice_payment', sourceId: linked._id }).lean()
    expect(paymentTransaction?.propertyId?.toString()).toBe(String(ownProperty._id))

    const createdAudit = await AuditEvent.findOne({ organizationId, entityId: String(linked._id), action: 'finance.invoice.created' }).lean()
    expect(createdAudit?.metadata?.propertyId).toBe(String(ownProperty._id))
    expect(createdAudit?.metadata?.propertyReference).toBe('gulshan-lake-residence')
  })

  it('persists income and expense transactions and returns them in the correct date windows', async () => {
    const now = new Date()
    const historicalDate = new Date('2024-06-15T08:00:00.000Z')
    const income = await FinanceService.createTransaction(organizationId, actor.id, {
      type: 'income', category: 'Other Income', amount: 125000, transactionDate: now,
      paymentMethod: 'bank', status: 'paid', description: 'Phase 5 current income',
    })
    const expense = await FinanceService.createTransaction(organizationId, actor.id, {
      type: 'expense', category: 'Operations', amount: 25000, transactionDate: now,
      paymentMethod: 'cash', status: 'paid', description: 'Phase 5 current expense',
    })
    const historical = await FinanceService.createTransaction(organizationId, actor.id, {
      type: 'expense', category: 'Operations', amount: 5000, transactionDate: historicalDate,
      paymentMethod: 'cash', status: 'paid', description: 'Phase 5 historical expense',
    })

    expect(await FinanceTransaction.exists({ _id: income._id, organizationId })).toBeTruthy()
    expect(await FinanceTransaction.exists({ _id: expense._id, organizationId })).toBeTruthy()

    const today = now.toISOString().slice(0, 10)
    const current = await FinanceService.listTransactions(organizationId, { startDate: today, endDate: today }, { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' })
    const currentIds = current.data.map((row: any) => String(row._id))
    expect(currentIds).toContain(String(income._id))
    expect(currentIds).toContain(String(expense._id))
    expect(currentIds).not.toContain(String(historical._id))

    const historicalRows = await FinanceService.listTransactions(organizationId, { startDate: '2024-06-15', endDate: '2024-06-15' }, { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' })
    expect(historicalRows.data.map((row: any) => String(row._id))).toContain(String(historical._id))
  })

  it('removes current billing information without changing historical invoice, payment or accounting snapshots', async () => {
    await FinanceService.updateBillingProfile(organizationId, actor, {
      legalName: 'Phase Five Holdings Ltd', email: 'billing@phase5.test', phone: '+8801999999999',
      address: 'Historic Billing Address, Dhaka', taxId: 'VAT-PHASE5-001',
    })
    const invoice = await FinanceService.createInvoice(organizationId, actor, invoicePayload('sent'))
    await FinanceService.recordInvoicePayment(organizationId, actor, String(invoice._id), {
      amount: 10000, paidAt: new Date(), paymentMethod: 'bank', reference: 'BILLING-SNAPSHOT-PAYMENT',
    })
    const before: any = await FinanceInvoice.findById(invoice._id).lean()
    const paymentTransactionBefore: any = await FinanceTransaction.findOne({ organizationId, sourceType: 'invoice_payment', sourceId: invoice._id }).lean()

    const billing = await FinanceService.removeBillingProfile(organizationId, actor, 'Phase 5 regression removal')
    expect(billing.profile).toBeNull()

    const after: any = await FinanceInvoice.findById(invoice._id).lean()
    const paymentTransactionAfter: any = await FinanceTransaction.findOne({ organizationId, sourceType: 'invoice_payment', sourceId: invoice._id }).lean()
    expect(after.issuerSnapshot).toEqual(before.issuerSnapshot)
    expect(after.issuerSnapshot.legalName).toBe('Phase Five Holdings Ltd')
    expect(after.issuerSnapshot.address).toBe('Historic Billing Address, Dhaka')
    expect(after.issuerSnapshot.taxId).toBe('VAT-PHASE5-001')
    expect(after.payments).toEqual(before.payments)
    expect(String(paymentTransactionAfter?._id)).toBe(String(paymentTransactionBefore?._id))
    expect(paymentTransactionAfter?.accountingJournalId || null).toEqual(paymentTransactionBefore?.accountingJournalId || null)
  })

})
