import mongoose from 'mongoose'
import config from '../../config'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { WebsiteStudio, WebsiteStudioReceipt, WebsiteStudioRevision } from '../module/websiteBuilder/websiteStudio.model'
import { WebsiteStudioService } from '../module/websiteBuilder/websiteStudio.service'

// Register the transaction's audit/outbox/page collections without changing tenants.
void WebsiteStudioService
async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Use --apply after taking a verified backup. This migration only creates missing collections and Studio indexes; it does not publish, reset, or replace content.')
  await mongoose.connect(config.database_url as string, { autoIndex: false, autoCreate: false })
  if (!(await mongoSupportsTransactions())) throw new Error('Website Studio requires a replica set or mongos; standalone MongoDB is not supported')
  for (const model of Object.values(mongoose.models)) {
    try { await model.createCollection() } catch (error) { if ((error as { code?: number }).code !== 48) throw error }
  }
  for (const model of [WebsiteStudio, WebsiteStudioReceipt, WebsiteStudioRevision]) await model.createIndexes()
  console.log(JSON.stringify({ ok: true, createdStudioIndexes: true, contentModified: false, note: 'Drafts initialize lazily on the first edit. No template or published content was changed.' }))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }).finally(() => mongoose.disconnect())
