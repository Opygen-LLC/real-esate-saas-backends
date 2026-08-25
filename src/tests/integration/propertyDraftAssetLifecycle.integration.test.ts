import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const removedKeys: string[] = []
vi.mock('../../app/module/websiteBuilder/objectStorage.service', () => ({
  ObjectStorageService: {
    remove: vi.fn(async (key: string) => { removedKeys.push(key) }),
    exists: vi.fn(async () => true),
    publicUrl: vi.fn((key: string) => `https://media.example.test/${key}`),
  },
}))
vi.mock('../../app/module/operationsQueue/operationsQueue.service', () => ({
  OperationsQueueService: {
    cancel: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
  },
}))

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let WebsiteAsset: any
let WebsiteBuilderService: any
let WebsiteUploadIntent: any
const organizationId = 'phase10-draft-assets'

const createDraftAsset = async (sessionId: string, suffix: string, createdAt = new Date(), size = 1500, lastReferencedAt?: Date) => {
  const now = new Date()
  const result = await WebsiteAsset.collection.insertOne({
    organizationId,
    context: 'property-draft',
    uploadSessionId: sessionId,
    claimed: false,
    key: `tenants/${organizationId}/properties/drafts/${sessionId}/${suffix}.jpg`,
    url: `https://media.example.test/${suffix}.jpg`,
    mimeType: 'image/jpeg',
    size,
    status: 'ready',
    variants: [],
    createdAt,
    lastReferencedAt: lastReferencedAt || createdAt,
    updatedAt: now,
  })
  return String(result.insertedId)
}

suite('Phase 10 property draft asset lifecycle integration', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.PROPERTY_DRAFT_ASSET_TTL_MINUTES = '60'
    process.env.PROPERTY_DRAFT_CLEANUP_INTERVAL_MINUTES = '15'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ WebsiteAsset } = await import('../../app/module/websiteBuilder/websiteAsset.model'))
    ;({ WebsiteBuilderService } = await import('../../app/module/websiteBuilder/websiteBuilder.service'))
    ;({ WebsiteUploadIntent } = await import('../../app/module/websiteBuilder/websiteUploadIntent.model'))
    await Organization.create({
      organizationId,
      agencyName: 'Phase 10 Draft Asset Realty',
      email: 'draft-assets@example.test',
      phone: '+8801755555555',
      sub_domain: 'phase10-draft-assets',
      storageUsedBytes: 5000,
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 100, maxAgents: 5 },
    })
  }, 20_000)

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('normal cancel deletes only unclaimed session assets and decrements storage usage', async () => {
    removedKeys.length = 0
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const assetId = await createDraftAsset(sessionId, 'cancelled', new Date(), 1500)
    await WebsiteAsset.collection.insertOne({
      organizationId,
      context: 'property',
      uploadSessionId: sessionId,
      claimed: true,
      claimedByPropertyId: new mongoose.Types.ObjectId(),
      key: `tenants/${organizationId}/properties/claimed.jpg`,
      url: 'https://media.example.test/claimed.jpg',
      mimeType: 'image/jpeg', size: 700, status: 'ready', variants: [], createdAt: new Date(), updatedAt: new Date(),
    })

    const result = await WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, sessionId)
    expect(result).toMatchObject({ deleted: 1, bytesReleased: 1500 })
    expect(await WebsiteAsset.exists({ _id: assetId })).toBeNull()
    expect(await WebsiteAsset.exists({ organizationId, context: 'property', claimed: true })).toBeTruthy()
    expect(removedKeys.some((key) => key.includes('cancelled.jpg'))).toBe(true)
    const org = await Organization.findOne({ organizationId }).lean()
    expect(org.storageUsedBytes).toBe(3500)
  })

  it('TTL cleanup removes abandoned draft sessions after the configured crash-protection window', async () => {
    removedKeys.length = 0
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const assetId = await createDraftAsset(sessionId, 'abandoned', new Date(Date.now() - 2 * 60 * 60_000), 1000)
    const result = await WebsiteBuilderService.cleanupAbandonedPropertyDraftAssets(100)
    expect(result.sessions).toBeGreaterThanOrEqual(1)
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(await WebsiteAsset.exists({ _id: assetId })).toBeNull()
    expect(removedKeys.some((key) => key.includes('abandoned.jpg'))).toBe(true)
    const org = await Organization.findOne({ organizationId }).lean()
    expect(org.storageUsedBytes).toBe(2500)
  })

  it('activity-based cleanup preserves an old draft session that was recently touched', async () => {
    removedKeys.length = 0
    const sessionId = '33333333-3333-4333-8333-333333333333'
    const old = new Date(Date.now() - 2 * 60 * 60_000)
    const recent = new Date()
    const assetId = await createDraftAsset(sessionId, 'recently-touched', old, 600, recent)
    const result = await WebsiteBuilderService.cleanupAbandonedPropertyDraftAssets(100)
    expect(result.skippedActive).toBeGreaterThanOrEqual(0)
    expect(await WebsiteAsset.exists({ _id: assetId })).toBeTruthy()
    expect(removedKeys.some((key) => key.includes('recently-touched.jpg'))).toBe(false)
  })

  it('touch refreshes the entire tenant-scoped draft session activity timestamp', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444'
    const old = new Date(Date.now() - 2 * 60 * 60_000)
    const firstId = await createDraftAsset(sessionId, 'touch-first', old, 200, old)
    const secondId = await createDraftAsset(sessionId, 'touch-second', old, 200, old)
    const before = Date.now()
    const touched = await WebsiteBuilderService.touchPropertyDraftSession(organizationId, sessionId)
    expect(touched.assets).toBe(2)
    const rows = await WebsiteAsset.find({ _id: { $in: [firstId, secondId] } }).lean()
    expect(rows).toHaveLength(2)
    expect(rows.every((row: any) => new Date(row.lastReferencedAt).getTime() >= before)).toBe(true)
  })


  it('session reconciliation is tenant scoped and cleanup is idempotent', async () => {
    const sessionId = '55555555-5555-4555-8555-555555555555'
    const assetId = await createDraftAsset(sessionId, 'tenant-a', new Date(), 100)
    await WebsiteAsset.collection.insertOne({ organizationId: 'other-tenant', context: 'property-draft', uploadSessionId: sessionId, claimed: false, key: 'tenants/other-tenant/properties/drafts/x.jpg', url: 'https://media.example.test/x.jpg', mimeType: 'image/jpeg', size: 100, status: 'ready', variants: [], createdAt: new Date(), lastReferencedAt: new Date(), updatedAt: new Date() })
    const reconciled = await WebsiteBuilderService.getPropertyDraftSession(organizationId, sessionId)
    expect(reconciled.assets.map((a:any)=>String(a._id))).toContain(assetId)
    expect(reconciled.assets.every((a:any)=>a.key.includes(organizationId))).toBe(true)
    const first = await WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, sessionId)
    const second = await WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, sessionId)
    expect(first.deleted).toBeGreaterThanOrEqual(1)
    expect(second.deleted).toBe(0)
    expect(await WebsiteAsset.exists({ organizationId: 'other-tenant', uploadSessionId: sessionId })).toBeTruthy()
  })

  it('explicit cleanup keeps cancelled intent tombstones and generic orphan cleanup ignores property drafts', async () => {
    const sessionId = '66666666-6666-4666-8666-666666666666'
    const assetId = await createDraftAsset(sessionId, 'old-draft', new Date(Date.now()-10*24*60*60_000), 100)
    const asset:any = await WebsiteAsset.findById(assetId).lean()
    await WebsiteUploadIntent.create({ organizationId, key: asset.key, objectKeys:[asset.key], declaredSize:100, mimeType:'image/jpeg', context:'property-draft', uploadSessionId:sessionId, status:'pending', lastReferencedAt:new Date(), expiresAt:new Date(Date.now()+60*60_000) })
    await WebsiteBuilderService.cleanupOrphanAssets(100)
    expect(await WebsiteAsset.exists({ _id: assetId })).toBeTruthy()
    await WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, sessionId)
    const tombstone = await WebsiteUploadIntent.findOne({ organizationId, key: asset.key }).lean()
    expect(tombstone?.status).toBe('cancelled')
    expect(new Date(tombstone.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

})
