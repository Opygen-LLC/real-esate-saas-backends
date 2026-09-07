import mongoose from 'mongoose'
import config from '../../config'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { Viewing } from '../module/viewing/viewing.model'
import { ViewingRequestReceipt } from '../module/viewing/viewingRequestReceipt.model'
import { PublicViewingRateCounter } from '../middlewares/publicViewingRateLimiter'
import { OperationsJob } from '../module/operationsQueue/operationsJob.model'
import { ViewingService } from '../module/viewing/viewing.service'
import { FinanceService } from '../module/finance/finance.service'

// Importing these services registers the collections used by their transactions.
void ViewingService; void FinanceService
async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Run with --apply during a maintenance window after a verified backup. This creates collections/indexes and initializes missing schedule versions; it never repairs finance history.')
  await mongoose.connect(config.database_url as string, { autoIndex: false })
  if (!(await mongoSupportsTransactions())) throw new Error('Phase 1 requires a replica set or mongos')
  // A transaction cannot create a previously absent collection on every topology.
  for (const model of Object.values(mongoose.models)) {
    try { await model.createCollection() } catch (error: any) { if (error?.code !== 48) throw error }
  }
  for (const model of [Viewing, ViewingRequestReceipt, PublicViewingRateCounter, OperationsJob]) await model.createIndexes()
  const versions = await Viewing.updateMany({ scheduleVersion: { $exists: false } }, { $set: { scheduleVersion: 1 } })
  console.log(JSON.stringify({ ok: true, initializedScheduleVersions: versions.modifiedCount, note: 'No financial records changed. Run audit:phase1-atomic and the replica-set integration gate.' }))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }).finally(() => mongoose.disconnect())
