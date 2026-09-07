import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { buildCatalogPlan } from '../module/property/propertyCatalog.pipeline'
import { PUBLIC_PROPERTY_STATUSES } from '../../contracts/websiteCatalog/property'

/** Read-only profiling. No indexes are created; executionStats is explicitly opt-in. */
async function run() {
  const organizationId = process.env.PHASE2_ORGANIZATION_ID
  const uri = process.env.PHASE2_DATABASE_URL
  if (!uri || !organizationId) throw new Error('Set PHASE2_DATABASE_URL and PHASE2_ORGANIZATION_ID explicitly')
  const execute = process.argv.includes('--execution-stats')
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9)
  const maxTimeMS = 10_000
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: maxTimeMS })
  const db = mongoose.connection.db!
  const org = await db.collection('organizations').findOne({ organizationId }, { projection: { areaConversion: 1 } })
  if (!org) throw new Error('The specified tenant does not exist')
  const conversion = org.areaConversion || {}
  const baseWhere = { organizationId, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }
  const cases = [
    { name: 'latest-public-page', filters: {}, sortBy: 'createdAt', sortOrder: 'desc' as const, skip: 0 },
    { name: 'discounted-price-ascending', filters: {}, sortBy: 'price', sortOrder: 'asc' as const, skip: 0 },
    { name: 'discounted-price-second-page', filters: {}, sortBy: 'price', sortOrder: 'asc' as const, skip: 20 },
    { name: 'discounted-budget', filters: { minPrice: 1_000_000, maxPrice: 20_000_000 }, sortBy: 'price', sortOrder: 'asc' as const, skip: 0 },
    { name: 'normalized-area', filters: { minArea: 1, maxArea: 10, areaUnit: 'katha' }, sortBy: 'area', sortOrder: 'desc' as const, skip: 0 },
  ]
  const reports: unknown[] = []
  for (const item of cases) {
    const plan = buildCatalogPlan({ baseWhere, ...item, limit: 20, publicView: true, conversion })
    for (const kind of ['data', 'count'] as const) {
      const explain = await db.collection('properties').aggregate(plan[kind], { maxTimeMS, allowDiskUse: true }).explain(execute ? 'executionStats' : 'queryPlanner')
      const stages = new Set<string>(); const indexes = new Set<string>(); const metrics: Record<string, unknown>[] = []
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'stage' && typeof child === 'string') stages.add(child)
          if (key === 'indexName' && typeof child === 'string') indexes.add(child)
          if (key === 'executionStats' && child && typeof child === 'object') {
            const stats = child as Record<string, unknown>
            metrics.push(Object.fromEntries(['nReturned', 'totalKeysExamined', 'totalDocsExamined', 'executionTimeMillis'].map((name) => [name, stats[name]])))
          }
          visit(child)
        }
      }
      visit(explain)
      reports.push({ case: item.name, kind, stages: [...stages], indexes: [...indexes], metrics })
    }
  }
  const result = { generatedAt: new Date().toISOString(), tenantHash: createHash('sha256').update(organizationId).digest('hex').slice(0, 16), mode: execute ? 'executionStats' : 'queryPlanner', maxTimeMS, indexesChanged: false, reports }
  const json = JSON.stringify(result, null, 2)
  if (output) writeFileSync(output, json + '\n', { flag: 'wx', mode: 0o600 })
  console.log(json)
}
run().catch((error) => { console.error(error instanceof Error ? error.message : 'Catalog profiling failed'); process.exitCode = 1 }).finally(() => mongoose.disconnect())
