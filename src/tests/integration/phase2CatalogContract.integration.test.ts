import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose, { Types } from 'mongoose'
import { randomUUID } from 'node:crypto'
import { buildCatalogPlan } from '../../app/module/property/propertyCatalog.pipeline'
import { toPublicProperty } from '../../app/module/property/publicProperty.serializer'

// This suite must FAIL, not silently skip, when its isolated database is unavailable.
const uri = process.env.PHASE2_TEST_DATABASE_URL
if (!uri) throw new Error('PHASE2_TEST_DATABASE_URL is required for the Phase 2 database release gate')
const databaseName = new URL(uri).pathname.slice(1)
if (!/^phase2_catalog_test(?:_[a-zA-Z0-9_-]+)?$/.test(databaseName)) throw new Error('Use a dedicated phase2_catalog_test database, never production')
const collectionName = `phase2_fixture_${randomUUID().replace(/-/g, '')}`
let collection: ReturnType<NonNullable<typeof mongoose.connection.db>['collection']>
const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'))
const tenant = 'phase2-contract-tenant'
const baseWhere = { organizationId: tenant, status: { $in: ['Available', 'UnderOffer'] }, quotaLocked: { $ne: true } }
const rows = [
  { _id: id(1), price: 1000, isDiscount: true, discountedPrice: 100, area: 2, areaUnit: 'katha' },
  { _id: id(2), price: 200, area: 1000, areaUnit: 'sqft' },
  { _id: id(3), price: 300, isDiscount: true, discountedPrice: 200, area: 3, areaUnit: 'decimal' },
  { _id: id(4), price: 50, hiddenPublicFields: ['price', 'area'], area: 999, areaUnit: 'acre' },
  { _id: id(5), price: 0 },
  { _id: id(6), price: 700, isDiscount: true, discountedPrice: 1, hiddenPublicFields: ['discount'] },
  { _id: id(7), price: 1, organizationId: 'other-tenant' },
  { _id: id(8), price: 2, status: 'Draft' },
  { _id: id(9), price: 3, quotaLocked: true },
].map((row) => ({ organizationId: tenant, status: 'Available', propertyType: 'Apartment', listingType: 'ForSale', title: `Property ${row._id}`, ...row }))
async function execute(filters: Record<string, unknown> = {}, sortOrder: 'asc' | 'desc' = 'asc', page = 1, sortBy = 'price') {
  const plan = buildCatalogPlan({ baseWhere, filters, sortBy, sortOrder, skip: (page - 1) * 2, limit: 2, publicView: true })
  return { data: await collection.aggregate(plan.data).toArray(), count: await collection.aggregate(plan.count).toArray() }
}
describe('Phase 2 real MongoDB catalog ordering and privacy', () => {
  beforeAll(async () => {
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10_000 })
    collection = mongoose.connection.db!.collection(collectionName)
    await collection.insertMany(rows)
  })
  afterAll(async () => {
    if (collection) await collection.drop()
    await mongoose.disconnect()
  })
  it('orders discounted values globally, with deterministic tie-breaks across pages', async () => {
    const a = await execute(); const b = await execute({}, 'asc', 2); const c = await execute({}, 'asc', 3)
    expect([...a.data, ...b.data, ...c.data].map((row) => String(row._id))).toEqual([1, 2, 3, 6, 4, 5].map((n) => String(id(n))))
    expect(a.count[0].total).toBe(6)
  })
  it('keeps hidden/missing prices last in descending order too', async () => {
    const a = await execute({}, 'desc'); const b = await execute({}, 'desc', 2); const c = await execute({}, 'desc', 3)
    expect([...a.data, ...b.data, ...c.data].map((row) => String(row._id))).toEqual([6, 3, 2, 1, 5, 4].map((n) => String(id(n))))
  })
  it('filters discounted prices before count and pagination without including hidden prices', async () => {
    const result = await execute({ minPrice: 0, maxPrice: 150 })
    expect(result.data.map((row) => String(row._id))).toEqual([String(id(1))]); expect(result.count[0].total).toBe(1)
    expect(toPublicProperty(result.data[0]).effectivePrice).toBe(100)
  })
  it('normalizes area units and excludes hidden area', async () => {
    const result = await execute({ minArea: 1.5, maxArea: 2, areaUnit: 'katha' }, 'asc', 1, 'area')
    expect(result.data.map((row) => String(row._id))).toEqual([String(id(3)), String(id(1))])
    expect(result.count[0].total).toBe(2)
  })
})
