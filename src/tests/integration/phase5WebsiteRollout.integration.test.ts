import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertIsolatedTestDatabase } from '../../app/db/isolatedTestDatabase'
import { CURRENT_WEBSITE_RENDERER_VERSION, LEGACY_WEBSITE_RENDERER_VERSION } from '../../contracts/websiteCatalog/manifest'

const database = assertIsolatedTestDatabase(process.env.TEST_DATABASE_URL)
if (!new URL(database).pathname.startsWith('/phase5_website_rollout_')) throw new Error('Phase 5 rollout tests require their own phase5_website_rollout_* database')

let mongoose: typeof import('mongoose')
let service: typeof import('../../app/module/websiteBuilder/websiteStudio.service')['WebsiteStudioService']
let models: Record<string, any>
let organizationId = ''
const mutation = (state: any) => ({ expectedDraftRevision: state.draftRevision, expectedPublicationRevision: state.publicationRevision, mutationId: randomUUID() })

describe('Phase 5 website renderer rollout and rollback', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = database
    process.env.NODE_ENV = 'test'
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    mongoose = await import('mongoose')
    await mongoose.connect(database, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 })
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 })
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('A real MongoDB replica set is required')
    await mongoose.connection.dropDatabase()
    service = (await import('../../app/module/websiteBuilder/websiteStudio.service')).WebsiteStudioService
    models = mongoose.models
    for (const model of Object.values(models)) await model.createCollection()
    for (const name of ['Organization', 'WebsiteStudio', 'WebsiteStudioRevision', 'WebsiteStudioReceipt', 'OperationsJob']) await models[name]?.createIndexes?.()
  }, 60000)

  beforeEach(async () => {
    delete process.env.WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS
    await Promise.all(Object.values(models).map((model: any) => model.deleteMany?.({})))
    organizationId = `phase5_${randomUUID().replace(/-/g, '')}`
    await models.Organization.create({
      organizationId,
      agencyName: 'Existing rollout fixture',
      phone: '+8801700000000',
      email: `${organizationId}@example.invalid`,
      sub_domain: organizationId.replace('_', '-'),
      templateId: 'template-3',
      websiteStatus: 'published',
      websiteSettings: { renderMode: 'template', publicationRevision: 0, content: { home: { heroTitle: 'Legacy live site' } } },
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 },
    })
    process.env.WEBSITE_RENDERER_ROLLOUT_MODE = 'disabled'
  })

  afterAll(async () => {
    delete process.env.WEBSITE_RENDERER_ROLLOUT_MODE
    delete process.env.WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS
    if (mongoose?.connection.readyState) await mongoose.connection.dropDatabase()
    await mongoose?.disconnect()
  })

  it('keeps an unmarked historical tenant on legacy-v1 and blocks silent adoption while rollout is paused', async () => {
    const initial = await service.getState(organizationId)
    expect(initial.snapshot.websiteSettings.rendererVersion).toBe(LEGACY_WEBSITE_RENDERER_VERSION)
    const draft = await service.saveDraft(organizationId, { ...mutation(initial), patch: { websiteSettings: { rendererVersion: CURRENT_WEBSITE_RENDERER_VERSION } } })
    await expect(service.publish(organizationId, mutation(draft))).rejects.toMatchObject({ statusCode: 409, code: 'WEBSITE_RENDERER_ROLLOUT_PAUSED' })
    const live = await models.Organization.findOne({ organizationId }).lean()
    expect(live.websiteSettings.rendererVersion).not.toBe(CURRENT_WEBSITE_RENDERER_VERSION)
    expect(live.websiteSettings.publicationRevision).toBe(0)
    expect(live.websiteSettings.content.home.heroTitle).toBe('Legacy live site')
  })

  it('allows explicit opt-in, records the renderer in history, and can roll back to the legacy renderer', async () => {
    process.env.WEBSITE_RENDERER_ROLLOUT_MODE = 'opt-in'
    const initial = await service.getState(organizationId)
    const draft = await service.saveDraft(organizationId, { ...mutation(initial), patch: { websiteSettings: { rendererVersion: CURRENT_WEBSITE_RENDERER_VERSION }, metaTitle: 'Premium v2' } })
    const published = await service.publish(organizationId, mutation(draft))
    expect(published.snapshot.websiteSettings.rendererVersion).toBe(CURRENT_WEBSITE_RENDERER_VERSION)
    let live = await models.Organization.findOne({ organizationId }).lean()
    expect(live.websiteSettings.rendererVersion).toBe(CURRENT_WEBSITE_RENDERER_VERSION)
    expect(live.websiteSettings.content.home.heroTitle).toBe('Legacy live site')
    const history = await service.history(organizationId)
    expect(history.some((entry: any) => entry.rendererVersion === CURRENT_WEBSITE_RENDERER_VERSION)).toBe(true)
    expect(history.some((entry: any) => entry.revision === 0 && entry.rendererVersion === LEGACY_WEBSITE_RENDERER_VERSION)).toBe(true)

    process.env.WEBSITE_RENDERER_ROLLOUT_MODE = 'disabled'
    const restored = await service.restore(organizationId, { ...mutation(published), revision: 0 })
    expect(restored.snapshot.websiteSettings.rendererVersion).toBe(LEGACY_WEBSITE_RENDERER_VERSION)
    await service.publish(organizationId, mutation(restored))
    live = await models.Organization.findOne({ organizationId }).lean()
    expect(live.websiteSettings.rendererVersion).toBe(LEGACY_WEBSITE_RENDERER_VERSION)
    expect(live.websiteSettings.content.home.heroTitle).toBe('Legacy live site')
  })

  it('can restrict opt-in publication to a pilot organization cohort', async () => {
    process.env.WEBSITE_RENDERER_ROLLOUT_MODE = 'opt-in'
    process.env.WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS = 'another_fixture'
    const initial = await service.getState(organizationId)
    let draft = await service.saveDraft(organizationId, { ...mutation(initial), patch: { websiteSettings: { rendererVersion: CURRENT_WEBSITE_RENDERER_VERSION } } })
    await expect(service.publish(organizationId, mutation(draft))).rejects.toMatchObject({ statusCode: 409, code: 'WEBSITE_RENDERER_ROLLOUT_PAUSED' })

    process.env.WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS = organizationId
    draft = await service.getState(organizationId)
    const published = await service.publish(organizationId, mutation(draft))
    expect(published.snapshot.websiteSettings.rendererVersion).toBe(CURRENT_WEBSITE_RENDERER_VERSION)
  })
})
