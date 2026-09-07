import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertIsolatedTestDatabase } from '../../app/db/isolatedTestDatabase'
import type { StudioState } from '../../contracts/websiteCatalog/studio'

// Never silently skip this release gate. Only the disposable local database is permitted.
const database = assertIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
if (!new URL(database).pathname.startsWith('/phase1_studio_')) throw new Error('Studio tests require their own phase1_studio_* database')
let mongoose: typeof import('mongoose')
let service: typeof import('../../app/module/websiteBuilder/websiteStudio.service')['WebsiteStudioService']
let outbox: typeof import('../../app/module/domainEvent/transactionalOutbox.service')['TransactionalOutbox']
let models: Record<string, any>
let server: Server | undefined
let base = '', organizationId = '', token = ''
let createToken: (user: any) => string
const expected = (state: StudioState) => ({ expectedDraftRevision: state.draftRevision, expectedPublicationRevision: state.publicationRevision, mutationId: randomUUID() })
async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
  const response = await fetch(`${base}/api/v1/organization/website${path}`, { method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, data: await response.json() as any, headers: response.headers }
}
describe('Studio: real replica-set transactions and authenticated routes', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = database; process.env.NODE_ENV = 'test'; process.env.REDIS_ENABLED = 'false'; process.env.WORKER_ENABLED = 'false'
    mongoose = await import('mongoose')
    await mongoose.connect(database, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 })
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 })
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('A real MongoDB replica set is required')
    await mongoose.connection.dropDatabase()
    const app = (await import('../../app')).default
    service = (await import('../../app/module/websiteBuilder/websiteStudio.service')).WebsiteStudioService
    outbox = (await import('../../app/module/domainEvent/transactionalOutbox.service')).TransactionalOutbox
    const { jwtHelpers } = await import('../../app/helpers/jwtHelpers')
    const config = (await import('../../config')).default
    createToken = (user) => jwtHelpers.createToken({ _id: String(user._id), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId: user.organizationId }, config.jwt.secret, config.jwt.expires_in)
    models = mongoose.models
    for (const model of Object.values(models)) await model.createCollection()
    for (const name of ['Organization', 'User', 'WebsiteStudio', 'WebsiteStudioRevision', 'WebsiteStudioReceipt', 'OperationsJob']) await models[name].createIndexes()
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { const address = server!.address(); if (!address || typeof address === 'string') throw new Error('Could not bind test API'); base = `http://127.0.0.1:${address.port}`; resolve() }) })
  }, 60000)
  beforeEach(async () => {
    organizationId = `studio_${randomUUID().replace(/-/g, '')}`
    const owner = await models.User.create({ name: 'Studio fixture owner', organizationId, userRole: 'agency_owner', status: 'active', isVerified: true, phoneNumber: `+88017${String(Date.now()).slice(-8)}`, email: `${organizationId}@example.invalid`, password: 'fixture-only-never-deploy' })
    await models.Organization.create({ organizationId, ownerId: owner._id, agencyName: 'Studio fixture', phone: owner.phoneNumber, email: `${organizationId}@example.invalid`, sub_domain: organizationId.replace('_', '-'), templateId: 'template-1', websiteStatus: 'published', websiteSettings: { renderMode: 'template', publicationRevision: 0, content: { home: { heroTitle: 'Original live title' } } }, subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 } })
    token = createToken(owner)
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    if (mongoose?.connection.readyState) await mongoose.connection.dropDatabase()
    await mongoose?.disconnect()
  })
  it('rejects anonymous reads and writes; saving does not change live content', async () => {
    expect((await request('/studio', 'GET', undefined, false)).status).toBe(401)
    const initial = await service.getState(organizationId)
    const input = { ...expected(initial), patch: { websiteSettings: { content: { home: { heroTitle: 'Saved draft only' } } } } }
    expect((await request('/studio/draft', 'PUT', input, false)).status).toBe(401)
    const saved = await request('/studio/draft', 'PUT', input)
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toContain('no-store')
    expect(saved.data.data.snapshot.websiteSettings.content.home.heroTitle).toBe('Saved draft only')
    const live = await models.Organization.findOne({ organizationId }).lean()
    expect(live.websiteSettings.content.home.heroTitle).toBe('Original live title')
    expect(live.websiteSettings.renderMode).toBe('template')
  })
  it('allows exactly one of two simultaneous stale writers to commit', async () => {
    const initial = await service.getState(organizationId)
    const results = await Promise.allSettled(['Writer A', 'Writer B'].map((title) => service.saveDraft(organizationId, { ...expected(initial), patch: { metaTitle: title } })))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.statusCode).toBe(409)
    expect((await service.getState(organizationId)).draftRevision).toBe(1)
  })
  it('rolls live settings, history, receipt and outbox back after a forced post-write failure', async () => {
    const draft = await service.saveDraft(organizationId, { ...expected(await service.getState(organizationId)), patch: { metaTitle: 'Must not publish' } })
    const original = outbox.emit.bind(outbox)
    vi.spyOn(outbox, 'emit').mockImplementation(async (...args) => { await original(...args); throw new Error('injected after outbox write') })
    const input = expected(draft)
    await expect(service.publish(organizationId, input)).rejects.toThrow('injected after outbox write')
    expect((await models.Organization.findOne({ organizationId }).lean()).websiteSettings.publicationRevision).toBe(0)
    expect(await models.WebsiteStudioRevision.countDocuments({ organizationId })).toBe(0)
    expect(await models.WebsiteStudioReceipt.countDocuments({ organizationId, mutationId: input.mutationId })).toBe(0)
    expect(await models.OperationsJob.countDocuments({ organizationId, type: 'domain_event_publish' })).toBe(0)
    expect((await service.getState(organizationId)).draftRevision).toBe(draft.draftRevision)
  })
  it('publishes once under retries and restores only the draft until republished', async () => {
    const draft = await service.saveDraft(organizationId, { ...expected(await service.getState(organizationId)), patch: { metaTitle: 'Published once' } })
    const input = expected(draft)
    const published = await service.publish(organizationId, input)
    expect(await service.publish(organizationId, input)).toEqual(published)
    expect(await models.OperationsJob.countDocuments({ organizationId, type: 'domain_event_publish' })).toBe(1)
    const restored = await service.restore(organizationId, { ...expected(published), revision: 0 })
    expect((await models.Organization.findOne({ organizationId }).lean()).metaTitle).toBe('Published once')
    expect(restored.snapshot.metaTitle).toBe('')
    await service.publish(organizationId, expected(restored))
    expect((await models.Organization.findOne({ organizationId }).lean()).metaTitle).toBe('')
  })
  it('does not read a different tenant history or accept unmanaged photographs', async () => {
    const initial = await service.getState(organizationId)
    await expect(service.restore(organizationId, { ...expected(initial), revision: 51 })).rejects.toMatchObject({ statusCode: 404 })
    await expect(service.saveDraft(organizationId, { ...expected(initial), patch: { logo: 'https://foreign.example/photo.jpg' } })).rejects.toMatchObject({ statusCode: 400 })
  })
})
