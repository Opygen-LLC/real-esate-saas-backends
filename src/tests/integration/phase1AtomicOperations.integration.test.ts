import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertIsolatedTestDatabase } from '../../app/db/isolatedTestDatabase'

const database = process.env.TEST_DATABASE_URL
const suite = database ? describe : describe.skip
let mongoose: typeof import('mongoose')
let server: Server | undefined
let base = ''
let models: Record<string, any> = {}
let FinanceService: any
let FinanceGlIntegrationService: any
let ViewingService: any
let WebsiteSubmissionService: any
let deliverViewingReminder: any
let jwtHelpers: any
let config: any
let sequence = 0
let organizationId = ''
let owner: any
let admin: any
let property: any
let foreignProperty: any
const day = () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const actor = () => ({ id: String(owner._id), role: 'agency_owner' })
const token = (user: any) => jwtHelpers.createToken({ _id: String(user._id), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId: user.organizationId }, config.jwt.secret, config.jwt.expires_in)
const booking = (overrides: Record<string, unknown> = {}) => ({ organizationId, propertyId: String(property._id), date: day(), startTime: '10:00', endTime: '11:00', clientName: 'Phase One Buyer', clientPhone: '01912345678', clientEmail: 'buyer@phase1.invalid', privacyConsent: true, policyVersion: 'phase1-policy-v1', ...overrides })
async function request(path: string, body?: unknown, options: { key?: string; user?: any; method?: string } = {}) {
  const response = await fetch(`${base}${path}`, { method: options.method || (body ? 'POST' : 'GET'), headers: {
    'content-type': 'application/json', ...(options.key ? { 'Idempotency-Key': options.key } : {}),
    ...(options.user ? { authorization: `Bearer ${token(options.user)}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const payload = await response.json() as any
  return { status: response.status, headers: response.headers, body: payload }
}
async function money(overrides: Record<string, unknown> = {}) {
  return models.FinanceTransaction.create({ organizationId, type: 'expense', category: 'Office', amount: 100, currency: 'BDT',
    transactionDate: new Date(), paymentMethod: 'cash', status: 'paid', description: 'Atomicity fixture', sourceType: 'manual', createdBy: owner._id, ...overrides })
}

suite('Phase 1 real replica-set atomicity and HTTP authorization', () => {
  beforeAll(async () => {
    assertIsolatedTestDatabase(database)
    process.env.DATABASE_URL = database!
    process.env.NODE_ENV = 'test'
    process.env.WORKER_ENABLED = 'false'
    process.env.REDIS_ENABLED = 'false'
    process.env.TRUST_PROXY = 'false'
    mongoose = await import('mongoose')
    await mongoose.connect(database!, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 })
    const hello: any = await mongoose.connection.db!.admin().command({ hello: 1 })
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('This integration suite requires real MongoDB transactions')
    await mongoose.connection.dropDatabase()
    const app = (await import('../../app')).default
    ;({ FinanceService } = await import('../../app/module/finance/finance.service'))
    ;({ FinanceGlIntegrationService } = await import('../../app/module/finance/financeGlIntegration.service'))
    ;({ ViewingService } = await import('../../app/module/viewing/viewing.service'))
    ;({ WebsiteSubmissionService } = await import('../../app/module/websiteSubmission/websiteSubmission.service'))
    ;({ deliverViewingReminder } = await import('../../app/module/viewing/viewingReminder.service'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default
    models = mongoose.models
    // Initialize all collections BEFORE opening any transaction, including outbox projections.
    for (const model of Object.values(models)) await model.createCollection()
    for (const name of ['User', 'Organization', 'Lead', 'Viewing', 'ViewingRequestReceipt', 'OperationsJob', 'PublicViewingRateCounter', 'Notification']) {
      if (models[name]) await models[name].createIndexes()
    }
    await models.PlatformSettings.create({ key: 'platform', privacy: { policyUrl: 'https://example.test/privacy', policyVersion: 'phase1-policy-v1', retentionDays: 365, legalReviewStatus: 'approved', legalReviewedAt: new Date() } })
    await new Promise<void>(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        if (!address || typeof address === 'string') throw new Error('Cannot start integration API')
        base = `http://127.0.0.1:${address.port}`; resolve()
      })
    })
  }, 60000)

  beforeEach(async () => {
    sequence += 1; organizationId = `org_phase1_atomic_${sequence}`
    await models.PublicViewingRateCounter.deleteMany({})
    owner = await models.User.create({ name: 'Fixture Owner', organizationId, userRole: 'agency_owner', status: 'active', isVerified: true,
      phoneNumber: `+880171000${String(sequence).padStart(4, '0')}`, email: `owner-${sequence}@phase1.invalid`, password: 'fixture-only-never-deploy' })
    admin = await models.User.create({ name: 'Fixture Admin', organizationId, userRole: 'agency_admin', status: 'active', isVerified: true,
      phoneNumber: `+880181000${String(sequence).padStart(4, '0')}`, email: `admin-${sequence}@phase1.invalid`, password: 'fixture-only-never-deploy' })
    await models.Organization.create({ organizationId, agencyName: 'Phase One Fixture', ownerId: owner._id, email: `agency-${sequence}@phase1.invalid`,
      phone: owner.phoneNumber, sub_domain: `phase1-atomic-${sequence}`, websiteStatus: 'published', subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 } })
    property = await models.Property.create({ organizationId, title: 'Fixture Apartment', slug: `phase1-${sequence}`, propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000, currency: 'BDT', city: 'Dhaka', country: 'Bangladesh' })
    foreignProperty = await models.Property.create({ organizationId: `foreign_${organizationId}`, title: 'Foreign Apartment', slug: `phase1-foreign-${sequence}`, propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 2000000, currency: 'BDT', city: 'Dhaka' })
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase()
    await mongoose?.disconnect()
  })

  it('rejects finance.write-only deletion at HTTP and direct service boundaries', async () => {
    const row = await money({ status: 'voided' })
    const response = await request(`/api/v1/finance/transactions/${row._id}`, { reason: 'Remove' }, { method: 'DELETE', user: admin })
    expect(response.status).toBe(403)
    await expect(FinanceService.deleteTransaction(organizationId, { id: String(admin._id), role: 'agency_owner' }, String(row._id))).rejects.toMatchObject({ statusCode: 403 })
    expect((await models.FinanceTransaction.findById(row._id).lean()).deletedAt).toBeFalsy()
    expect((await request(`/api/v1/finance/transactions/${row._id}`, { reason: 'Remove' }, { method: 'DELETE', user: owner })).status).toBe(200)
  })

  it('rolls journal, transaction and audit back when reversal fails after a database write', async () => {
    const journalId = new mongoose.Types.ObjectId()
    await models.FinanceJournalEntry.collection.insertOne({ _id: journalId, organizationId, journalNumber: 'fault-injection-only', status: 'POSTED' })
    const row = await money({ accountingJournalId: journalId })
    vi.spyOn(FinanceGlIntegrationService, 'isAutomaticPostingReady').mockResolvedValue(false)
    vi.spyOn(FinanceGlIntegrationService, 'reverseLinkedJournal').mockImplementation(async (...args: any[]) => {
      const session = args[5]
      expect(session?.inTransaction()).toBe(true)
      await models.FinanceJournalEntry.collection.updateOne({ _id: journalId }, { $set: { status: 'REVERSED' } }, { session })
      await models.FinanceTransaction.updateOne({ _id: row._id }, { $set: { reference: 'must-rollback' } }, { session })
      throw new Error('Injected reversal failure')
    })
    await expect(FinanceService.voidTransaction(organizationId, String(owner._id), String(row._id), 'Correction')).rejects.toThrow('Injected reversal failure')
    expect(await models.FinanceTransaction.findById(row._id).lean()).toMatchObject({ status: 'paid', reference: '' })
    expect((await models.FinanceJournalEntry.findById(journalId).lean()).status).toBe('POSTED')
    expect(await models.AuditEvent.countDocuments({ organizationId, entityId: String(row._id), action: 'finance.transaction.voided' })).toBe(0)
  })

  it('never removes linked invoice payments, even for an owner', async () => {
    const row = await money({ sourceType: 'invoice_payment', sourceId: new mongoose.Types.ObjectId(), status: 'voided' })
    await expect(FinanceService.deleteTransaction(organizationId, actor(), String(row._id))).rejects.toMatchObject({ code: 'FINANCE_LINKED_TRANSACTION' })
    expect((await models.FinanceTransaction.findById(row._id).lean()).deletedAt).toBeFalsy()
  })

  it('commits exactly one booking, lead, consent, receipt and inbox item for concurrent retries', async () => {
    const requests = await Promise.all(Array.from({ length: 5 }, () => request('/api/v1/viewing/public-request', booking(), { key: 'phase1-identical-request-key' })))
    expect(requests.map(r => r.status)).toEqual([201,201,201,201,201])
    expect(new Set(requests.map(r => r.body.data._id)).size).toBe(1)
    expect(requests.filter(r => r.headers.get('idempotency-replayed') === 'true')).toHaveLength(4)
    for (const name of ['Viewing','Lead','ConsentRecord','ViewingRequestReceipt','WebsiteSubmission']) expect(await models[name].countDocuments({ organizationId }), name).toBe(1)
    expect(await models.OperationsJob.countDocuments({ organizationId, type:'calendar_sync', status:'pending' })).toBe(1)
    expect(await models.OperationsJob.countDocuments({ organizationId, type:'viewing_reminder', status:'pending' })).toBe(1)
    expect(await models.OperationsJob.countDocuments({ organizationId, type:'domain_event_publish', status:'pending' })).toBeGreaterThan(0)
    expect(await models.Notification.countDocuments({ organizationId })).toBe(0)
    expect(requests[0].body.data.agentId).toBeUndefined()
    expect(requests[0].body.data.leadId).toBeUndefined()
    expect(requests[0].body.data.clientPhone).toBeUndefined()
  })

  it('returns 409 when a request key is reused for a different business request', async () => {
    expect((await request('/api/v1/viewing/public-request', booking(), {key:'phase1-payload-bound-key'})).status).toBe(201)
    const changed = await request('/api/v1/viewing/public-request', booking({startTime:'12:00',endTime:'13:00'}), {key:'phase1-payload-bound-key'})
    expect(changed.status).toBe(409)
    expect(await models.Viewing.countDocuments({ organizationId })).toBe(1)
  })

  it('serializes different-start overlapping requests rather than admitting write skew', async () => {
    const responses = await Promise.all([
      request('/api/v1/viewing/public-request', booking(), {key:'phase1-overlap-request-one'}),
      request('/api/v1/viewing/public-request', booking({startTime:'10:30',endTime:'11:30',clientPhone:'01812345678',clientEmail:'other@phase1.invalid'}), {key:'phase1-overlap-request-two'}),
    ])
    expect(responses.map(r=>r.status).sort()).toEqual([201,409])
    expect(await models.Viewing.countDocuments({ organizationId })).toBe(1)
    expect(await models.Lead.countDocuments({ organizationId })).toBe(1)
  })

  it('permits adjacent intervals, but rejects conflicting reactivation and merged invalid edits', async () => {
    const one = await request('/api/v1/viewing/public-request', booking(), {key:'phase1-adjacent-first-key'})
    const two = await request('/api/v1/viewing/public-request', booking({startTime:'11:00',endTime:'12:00'}), {key:'phase1-adjacent-second-key'})
    expect(one.status).toBe(201); expect(two.status).toBe(201)
    await expect(ViewingService.updateViewing(organizationId,one.body.data._id,{startTime:'11:30'},String(owner._id))).rejects.toMatchObject({code:'VIEWING_INVALID_WINDOW'})
    await ViewingService.updateViewing(organizationId,one.body.data._id,{status:'Cancelled'},String(owner._id))
    await ViewingService.updateViewing(organizationId,two.body.data._id,{startTime:'10:00',endTime:'11:00',status:'Rescheduled'},String(owner._id))
    await expect(ViewingService.updateViewing(organizationId,one.body.data._id,{status:'Confirmed'},String(owner._id))).rejects.toMatchObject({statusCode:409})
    expect((await models.Viewing.findById(one.body.data._id).lean()).status).toBe('Cancelled')
  })

  it('rolls lead/quota/consent/viewing/jobs back when inbox capture fails', async () => {
    vi.spyOn(WebsiteSubmissionService,'captureViewing').mockRejectedValueOnce(new Error('Injected inbox failure'))
    const result = await request('/api/v1/viewing/public-request',booking(),{key:'phase1-inbox-failure-key'})
    expect(result.status).toBe(500)
    for (const name of ['Lead','Viewing','ViewingRequestReceipt','WebsiteSubmission','ConsentRecord','OperationsJob']) expect(await models[name].countDocuments({organizationId}),name).toBe(0)
    if (models.LeadAllowanceReservation) expect(await models.LeadAllowanceReservation.countDocuments({organizationId})).toBe(0)
    expect((await request('/api/v1/viewing/public-request',booking(),{key:'phase1-inbox-failure-key'})).status).toBe(201)
  })

  it('rejects a foreign-tenant property without creating contact or booking records', async () => {
    const response = await request('/api/v1/viewing/public-request', booking({propertyId:String(foreignProperty._id)}), {key:'phase1-cross-tenant-request'})
    expect(response.status).toBe(404)
    expect(await models.Lead.countDocuments({organizationId})).toBe(0)
    expect(await models.Viewing.countDocuments({organizationId})).toBe(0)
  })

  it('deletes using a durable versioned calendar tombstone and cancels pending reminders', async () => {
    const created = await request('/api/v1/viewing/public-request',booking(),{key:'phase1-calendar-delete-key'})
    expect(created.status).toBe(201)
    await ViewingService.deleteViewing(organizationId,created.body.data._id)
    expect(await models.Viewing.countDocuments({organizationId})).toBe(0)
    expect(await models.OperationsJob.findOne({organizationId,type:'calendar_delete',status:'pending'}).lean()).toMatchObject({payload:{scheduleVersion:2}})
    expect(await models.OperationsJob.countDocuments({organizationId,type:'viewing_reminder',status:'pending'})).toBe(0)
  })

  it('rejects a new request whose valid time window is in the past', async () => {
    const response = await request('/api/v1/viewing/public-request', booking({ date: '2020-01-01' }), {key:'phase1-past-viewing-request'})
    expect(response.status).toBe(400)
    expect(await models.Viewing.countDocuments({organizationId})).toBe(0)
  })

  it('commits reminder effects once and ignores a replay of the worker lease', async () => {
    const created = await request('/api/v1/viewing/public-request',booking(),{key:'phase1-reminder-once-key'})
    expect(created.status).toBe(201)
    const job = await models.OperationsJob.findOneAndUpdate({organizationId,type:'viewing_reminder',entityId:created.body.data._id},
      {$set:{status:'processing',lockedBy:'phase1-test-lease',lockedAt:new Date()}},{new:true}).lean()
    expect(job).toBeTruthy()
    expect(await deliverViewingReminder(job)).toEqual({delivered:true})
    expect(await deliverViewingReminder(job)).toEqual({delivered:false})
    expect(await models.Notification.countDocuments({organizationId,jobId:String(job._id)})).toBe(1)
    expect((await models.OperationsJob.findById(job._id).lean()).effectsCommittedAt).toBeTruthy()
  })

  it('does not deliver an old reminder after the booking is rescheduled', async () => {
    const created = await request('/api/v1/viewing/public-request',booking(),{key:'phase1-reminder-stale-key'})
    expect(created.status).toBe(201)
    const job = await models.OperationsJob.findOneAndUpdate({organizationId,type:'viewing_reminder',entityId:created.body.data._id},
      {$set:{status:'processing',lockedBy:'phase1-stale-lease',lockedAt:new Date()}},{new:true}).lean()
    await ViewingService.updateViewing(organizationId,created.body.data._id,{startTime:'12:00',endTime:'13:00',status:'Rescheduled'},String(owner._id))
    expect(await deliverViewingReminder(job)).toEqual({delivered:false})
    expect(await models.Notification.countDocuments({organizationId,jobId:String(job._id)})).toBe(0)
  })

  it('keeps public health minimal and protects internal diagnostics', async () => {
    const publicHealth=await request('/health'); expect(publicHealth.status).toBe(200)
    expect(publicHealth.body).toEqual({status:'ok'}); expect(publicHealth.headers.get('cache-control')).toBe('no-store')
    expect([401,403]).toContain((await request('/internal/health')).status)
    expect([401,403]).toContain((await request('/internal/health',undefined,{user:owner})).status)
  })
})
