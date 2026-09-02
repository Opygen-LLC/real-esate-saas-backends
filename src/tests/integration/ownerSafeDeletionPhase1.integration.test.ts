import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let Lead: any
let WebsiteSubmission: any
let FinanceTransaction: any
let FinanceInvoice: any
let FinanceCommission: any
let AuditEvent: any
let jwtHelpers: any
let config: any

const tokenFor = (user: any) => ({
  authorization: `Bearer ${jwtHelpers.createToken({
    _id: user._id.toString(),
    phoneNumber: user.phoneNumber,
    email: user.email,
    userRole: user.userRole,
    organizationId: user.organizationId,
  }, config.jwt.secret, config.jwt.expires_in)}`,
})

const request = async (path: string, headers: Record<string, string>, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

const financeInvoice = (organizationId: string, createdBy: any, invoiceNumber: string, status: string, paidAmount = 0) => ({
  organizationId,
  invoiceNumber,
  clientName: 'Deletion Test Client',
  issueDate: new Date(),
  dueDate: new Date(Date.now() + 86_400_000),
  lineItems: [{ description: 'Advisory', quantity: 1, unitPrice: 1000, amount: 1000 }],
  subtotal: 1000,
  discount: 0,
  total: 1000,
  paidAmount,
  currency: 'BDT',
  status,
  payments: paidAmount > 0 ? [{ amount: paidAmount, paidAt: new Date(), paymentMethod: 'bank', recordedBy: createdBy }] : [],
  createdBy,
})

suite('agency-owner safe deletion phase 1', () => {
  const tenantA = 'org_owner_delete_a'
  const tenantB = 'org_owner_delete_b'
  let ownerA: any
  let adminA: any
  let ownerB: any
  let ownerAuthA: Record<string, string>
  let adminAuthA: Record<string, string>
  let ownerAuthB: Record<string, string>

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()

    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ WebsiteSubmission } = await import('../../app/module/websiteSubmission/websiteSubmission.model'))
    ;({ FinanceTransaction, FinanceInvoice, FinanceCommission } = await import('../../app/module/finance/finance.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    ownerA = await User.create({
      name: 'Owner Delete A', email: 'owner-delete-a@example.com', phoneNumber: '+8801710000001', password: 'unused-test-password',
      organizationId: tenantA, userRole: 'agency_owner', status: 'active', isVerified: true,
    })
    adminA = await User.create({
      name: 'Admin Delete A', email: 'admin-delete-a@example.com', phoneNumber: '+8801710000002', password: 'unused-test-password',
      organizationId: tenantA, userRole: 'agency_admin', status: 'active', isVerified: true,
    })
    ownerB = await User.create({
      name: 'Owner Delete B', email: 'owner-delete-b@example.com', phoneNumber: '+8801710000003', password: 'unused-test-password',
      organizationId: tenantB, userRole: 'agency_owner', status: 'active', isVerified: true,
    })

    await Organization.create([
      { organizationId: tenantA, agencyName: 'Owner Delete A Realty', email: 'office-a@example.com', phone: '+8801810000001', sub_domain: 'owner-delete-a', ownerId: ownerA._id, subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 5 } },
      { organizationId: tenantB, agencyName: 'Owner Delete B Realty', email: 'office-b@example.com', phone: '+8801810000002', sub_domain: 'owner-delete-b', ownerId: ownerB._id, subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 5 } },
    ])

    ownerAuthA = tokenFor(ownerA)
    adminAuthA = tokenFor(adminA)
    ownerAuthB = tokenFor(ownerB)

    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('bind failed')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 20_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('allows only the agency owner to delete a website submission and preserves its linked CRM lead', async () => {
    const lead = await Lead.create({
      organizationId: tenantA,
      name: 'Preserved CRM Lead',
      phone: '+8801910000001',
      normalizedPhone: '+8801910000001',
      source: 'Website',
      createdBy: ownerA._id,
    })
    const submission = await WebsiteSubmission.create({
      organizationId: tenantA,
      submissionType: 'CONTACT',
      status: 'PROCESSED',
      name: 'Preserved Submission',
      phone: '+8801910000001',
      linkedEntityType: 'Lead',
      linkedEntityId: lead._id,
      crmTransferStatus: 'COMPLETED',
      crmTransferOutcome: 'CREATED',
      submittedAt: new Date(),
    })

    const forbidden = await request(`/api/v1/website-submissions/${submission._id}`, adminAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Admin should not be allowed' }) })
    expect(forbidden.response.status).toBe(403)

    const removed = await request(`/api/v1/website-submissions/${submission._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Inbox cleanup' }) })
    expect(removed.response.status).toBe(200)
    expect(removed.body?.data?.linkedEntityPreserved).toBe(true)

    const storedSubmission = await WebsiteSubmission.findById(submission._id).lean()
    expect(storedSubmission?.deletedAt).toBeTruthy()
    expect(storedSubmission?.linkedEntityId?.toString()).toBe(String(lead._id))
    expect(await Lead.exists({ _id: lead._id, organizationId: tenantA })).toBeTruthy()

    const hidden = await request(`/api/v1/website-submissions/${submission._id}`, ownerAuthA)
    expect(hidden.response.status).toBe(404)
    expect(await AuditEvent.exists({ organizationId: tenantA, entityId: String(submission._id), action: 'website_submission.deleted', actorId: String(ownerA._id) })).toBeTruthy()
  })

  it('keeps deletion tenant-scoped even when another tenant record id is known', async () => {
    const foreignSubmission = await WebsiteSubmission.create({ organizationId: tenantB, submissionType: 'GENERAL_LEAD', status: 'NEW', name: 'Tenant B', phone: '+8801920000001', submittedAt: new Date() })
    const response = await request(`/api/v1/website-submissions/${foreignSubmission._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Cross tenant attempt' }) })
    expect(response.response.status).toBe(404)
    expect((await WebsiteSubmission.findById(foreignSubmission._id).lean())?.deletedAt).toBeFalsy()
  })

  it('requires Void -> Delete for manual money records and blocks linked finance transactions', async () => {
    const manual = await FinanceTransaction.create({
      organizationId: tenantA, type: 'expense', category: 'Office', amount: 500, currency: 'BDT', transactionDate: new Date(), paymentMethod: 'cash',
      status: 'voided', description: 'Voided manual expense', sourceType: 'manual', createdBy: ownerA._id, voidedAt: new Date(), voidedBy: ownerA._id, voidReason: 'Duplicate',
    })
    const linked = await FinanceTransaction.create({
      organizationId: tenantA, type: 'income', category: 'Invoice payment', amount: 1000, currency: 'BDT', transactionDate: new Date(), paymentMethod: 'bank',
      status: 'paid', description: 'Linked invoice payment', sourceType: 'invoice_payment', sourceId: new mongoose.Types.ObjectId(), createdBy: ownerA._id,
    })

    const adminDelete = await request(`/api/v1/finance/transactions/${manual._id}`, adminAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Admin attempt' }) })
    expect(adminDelete.response.status).toBe(403)

    const linkedDelete = await request(`/api/v1/finance/transactions/${linked._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Unsafe linked delete' }) })
    expect(linkedDelete.response.status).toBe(200)
    expect((await FinanceTransaction.findById(linked._id).lean())?.deletedAt).toBeTruthy()

    const activeManual = await FinanceTransaction.create({
      organizationId: tenantA, type: 'expense', category: 'Office', amount: 100, currency: 'BDT', transactionDate: new Date(), paymentMethod: 'cash',
      status: 'paid', description: 'Active manual expense', sourceType: 'manual', createdBy: ownerA._id,
    })
    const activeDelete = await request(`/api/v1/finance/transactions/${activeManual._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Direct delete active' }) })
    expect(activeDelete.response.status).toBe(200)
    expect((await FinanceTransaction.findById(activeManual._id).lean())?.deletedAt).toBeTruthy()

    const removed = await request(`/api/v1/finance/transactions/${manual._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Duplicate manual entry' }) })
    expect(removed.response.status).toBe(200)
    expect((await FinanceTransaction.findById(manual._id).lean())?.deletedAt).toBeTruthy()

    const list = await request('/api/v1/finance/transactions?page=1&limit=100', ownerAuthA)
    expect(list.response.status).toBe(200)
    expect(list.body?.data?.map((row: any) => row._id)).not.toContain(String(manual._id))
    expect(await AuditEvent.exists({ organizationId: tenantA, entityId: String(manual._id), action: 'finance.transaction.deleted' })).toBeTruthy()
  })

  it('allows draft, voided, sent, and paid invoices to be archived by the owner with cascade cleanup', async () => {
    const draft = await FinanceInvoice.create(financeInvoice(tenantA, ownerA._id, 'INV-DELETE-DRAFT', 'draft'))
    const voided = await FinanceInvoice.create({ ...financeInvoice(tenantA, ownerA._id, 'INV-DELETE-VOID', 'cancelled'), cancelledAt: new Date(), cancelledBy: ownerA._id, cancelReason: 'Client cancelled' })
    const paid = await FinanceInvoice.create(financeInvoice(tenantA, ownerA._id, 'INV-DELETE-PAID', 'paid', 1000))
    const sent = await FinanceInvoice.create(financeInvoice(tenantA, ownerA._id, 'INV-DELETE-SENT', 'sent'))

    expect((await request(`/api/v1/finance/invoices/${draft._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Duplicate draft' }) })).response.status).toBe(200)
    expect((await request(`/api/v1/finance/invoices/${voided._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Old voided invoice' }) })).response.status).toBe(200)
    expect((await request(`/api/v1/finance/invoices/${sent._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Sent invoice' }) })).response.status).toBe(200)
    expect((await request(`/api/v1/finance/invoices/${paid._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Paid invoice deleted by owner' }) })).response.status).toBe(200)

    expect((await FinanceInvoice.findById(draft._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceInvoice.findById(voided._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceInvoice.findById(sent._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceInvoice.findById(paid._id).lean())?.archivedAt).toBeTruthy()
  })

  it('allows cancelled, approved, and paid commissions to be archived by the owner', async () => {
    const cancelled = await FinanceCommission.create({
      organizationId: tenantA, commissionNumber: 'COM-DELETE-CANCELLED', agentId: ownerA._id, grossDealValue: 100000, commissionAmount: 5000,
      agentShare: 3000, companyShare: 2000, currency: 'BDT', status: 'cancelled', cancelledAt: new Date(), cancelledBy: ownerA._id, cancelReason: 'Deal cancelled', createdBy: ownerA._id,
    })
    const payoutTransaction = await FinanceTransaction.create({
      organizationId: tenantA, type: 'expense', category: 'Agent commission', amount: 3000, currency: 'BDT', transactionDate: new Date(), paymentMethod: 'bank',
      status: 'paid', description: 'Paid commission', sourceType: 'commission_payout', sourceId: new mongoose.Types.ObjectId(), createdBy: ownerA._id,
    })
    const paid = await FinanceCommission.create({
      organizationId: tenantA, commissionNumber: 'COM-DELETE-PAID', agentId: ownerA._id, grossDealValue: 100000, commissionAmount: 5000,
      agentShare: 3000, companyShare: 2000, currency: 'BDT', status: 'paid', paidAt: new Date(), payoutTransactionId: payoutTransaction._id, createdBy: ownerA._id,
    })
    const approved = await FinanceCommission.create({
      organizationId: tenantA, commissionNumber: 'COM-DELETE-APPROVED', agentId: ownerA._id, grossDealValue: 100000, commissionAmount: 5000,
      agentShare: 3000, companyShare: 2000, currency: 'BDT', status: 'approved', createdBy: ownerA._id,
    })

    expect((await request(`/api/v1/finance/commissions/${cancelled._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Cancelled record cleanup' }) })).response.status).toBe(200)
    expect((await request(`/api/v1/finance/commissions/${approved._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Approved commission cleanup' }) })).response.status).toBe(200)
    expect((await request(`/api/v1/finance/commissions/${paid._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Paid commission cleanup' }) })).response.status).toBe(200)

    expect((await FinanceCommission.findById(cancelled._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceCommission.findById(approved._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceCommission.findById(paid._id).lean())?.archivedAt).toBeTruthy()
    expect((await FinanceTransaction.findById(payoutTransaction._id).lean())?.deletedAt).toBeTruthy()
  })

  it('does not let one owner delete another tenant finance record', async () => {
    const foreign = await FinanceTransaction.create({
      organizationId: tenantB, type: 'expense', category: 'Other', amount: 50, currency: 'BDT', transactionDate: new Date(), paymentMethod: 'cash',
      status: 'voided', description: 'Tenant B manual transaction', sourceType: 'manual', createdBy: ownerB._id, voidedAt: new Date(), voidedBy: ownerB._id, voidReason: 'Duplicate',
    })
    expect((await request(`/api/v1/finance/transactions/${foreign._id}`, ownerAuthA, { method: 'DELETE', body: JSON.stringify({ reason: 'Cross tenant' }) })).response.status).toBe(404)
    expect((await request(`/api/v1/finance/transactions/${foreign._id}`, ownerAuthB, { method: 'DELETE', body: JSON.stringify({ reason: 'Owner B cleanup' }) })).response.status).toBe(200)
  })
})
