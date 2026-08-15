import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase1-manual-subscriptions'
const normalizeMethod = (value: unknown) => {
  const raw = String(value || '').toLowerCase()
  if (raw.includes('bkash')) return 'bkash'
  if (raw.includes('nagad')) return 'nagad'
  if (raw.includes('bank')) return 'bank'
  if (raw.includes('cash')) return 'cash'
  return 'other'
}
const allowedPlans = new Set(['starter', 'professional', 'agency', 'enterprise'])

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, 'PHASE1-MANUAL-SUBSCRIPTIONS')
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const billing = db.collection('billings')
  const payments = db.collection('subscriptionpayments')
  const requests = db.collection('subscriptionchangerequests')
  const organizations = db.collection('organizations')
  const paidFilter = { serviceType: 'subscription', status: 'paid' }
  const duplicateValues = (collection: any, field: string) => collection.aggregate([
    { $match: { [field]: { $type: 'string', $ne: '' } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray()
  const [paidCount, legacySourceCount, missingPaymentIds, missingRequestIds, duplicatePendingRows, duplicateOpenRequests, duplicatePaymentNumbers, duplicateReceiptNumbers, duplicateRequestNumbers] = await Promise.all([
    billing.countDocuments(paidFilter), organizations.countDocuments({ 'subscription.source': 'bkash' }),
    payments.countDocuments({ $or: [{ paymentNumber: { $exists: false } }, { receiptNumber: { $exists: false } }] }),
    requests.countDocuments({ requestNumber: { $exists: false } }),
    payments.aggregate([{ $match: { status: 'pending', changeRequestId: { $type: 'objectId' } } }, { $group: { _id: '$changeRequestId', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 20 }]).toArray(),
    requests.aggregate([{ $match: { status: { $in: ['pending_payment', 'payment_submitted'] } } }, { $group: { _id: '$organizationId', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 20 }]).toArray(),
    duplicateValues(payments, 'paymentNumber'), duplicateValues(payments, 'receiptNumber'), duplicateValues(requests, 'requestNumber'),
  ])
  const duplicateBusinessKeys = duplicatePaymentNumbers.length + duplicateReceiptNumbers.length + duplicateRequestNumbers.length
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} paidBilling=${paidCount} legacyBkashSources=${legacySourceCount} paymentIdsToBackfill=${missingPaymentIds} requestIdsToBackfill=${missingRequestIds} duplicatePendingRequests=${duplicatePendingRows.length} duplicateOpenTenantRequests=${duplicateOpenRequests.length} duplicateBusinessKeys=${duplicateBusinessKeys}`)
  if (duplicatePendingRows.length) console.warn(`[${MIGRATION}] Resolve duplicate pending payments before apply: ${duplicatePendingRows.map((row: any) => `${row._id}:${row.count}`).join(', ')}`)
  if (duplicateOpenRequests.length) console.warn(`[${MIGRATION}] Resolve tenants with multiple open requests before apply: ${duplicateOpenRequests.map((row: any) => `${row._id}:${row.count}`).join(', ')}`)
  if (duplicateBusinessKeys) console.warn(`[${MIGRATION}] Resolve duplicate payment/receipt/request numbers before apply.`)
  if (!cli.apply) { console.log(`[${MIGRATION}] No data changed. Re-run with --apply --confirm=PHASE1-MANUAL-SUBSCRIPTIONS after review.`); return }

  const backups = []
  backups.push(await backupDocuments({ collection: billing, filter: paidFilter, migrationName: MIGRATION, backupDir: cli.backupDir }))
  backups.push(await backupDocuments({ collection: organizations, filter: { 'subscription.source': 'bkash' }, migrationName: MIGRATION, backupDir: cli.backupDir }))
  backups.push(await backupDocuments({ collection: payments, filter: {}, migrationName: MIGRATION, backupDir: cli.backupDir }))
  backups.push(await backupDocuments({ collection: requests, filter: {}, migrationName: MIGRATION, backupDir: cli.backupDir }))
  if (duplicatePendingRows.length || duplicateOpenRequests.length || duplicateBusinessKeys) {
    throw new Error('Cannot apply migration while duplicate subscription payment/request records exist. Resolve the dry-run findings and rerun.')
  }

  let imported = 0
  const cursor = billing.find(paidFilter).sort({ createdAt: 1 })
  for await (const row of cursor) {
    const planId = allowedPlans.has(String(row.plan)) ? String(row.plan) : 'starter'
    const receiptNumber = String(row.invoiceId || `LEGACY-RCT-${row._id}`)
    const paymentNumber = `LEGACY-${String(row._id).toUpperCase()}`
    const reference = String(row.transactionId || row.paymentId || row.invoiceId || '')
    const paidAt = row.createdAt ? new Date(row.createdAt) : new Date()
    const result = await payments.updateOne({ receiptNumber }, { $setOnInsert: {
      paymentNumber, receiptNumber, organizationId: String(row.organizationId), changeRequestId: null,
      planId, planVersion: Math.max(1, Number(row.planVersion || 1)), billingCycle: ['monthly', 'yearly'].includes(String(row.billingCycle)) ? row.billingCycle : 'one-time',
      amount: Math.max(0, Number(row.amount || 0)), currency: 'BDT', method: normalizeMethod(row.paymentMethod), reference,
      paidAt, status: 'confirmed', notes: `Imported from legacy billing invoice ${receiptNumber}`, proofAssetId: null,
      recordedBy: 'migration', confirmedBy: 'migration', confirmedAt: paidAt, rejectedBy: '', rejectedAt: null, rejectedReason: '', periodStart: null, periodEnd: null,
      source: 'legacy_migration', createdAt: row.createdAt || new Date(), updatedAt: row.updatedAt || row.createdAt || new Date(),
    } }, { upsert: true })
    if (result.upsertedCount) imported += 1
  }

  const existingPayments = payments.find({ $or: [{ paymentNumber: { $exists: false } }, { receiptNumber: { $exists: false } }] })
  let paymentsBackfilled = 0
  for await (const row of existingPayments) {
    const suffix = String(row._id).toUpperCase()
    await payments.updateOne({ _id: row._id }, { $set: { paymentNumber: row.paymentNumber || `PAY-MIG-${suffix}`, receiptNumber: row.receiptNumber || `RCT-MIG-${suffix}` } })
    paymentsBackfilled += 1
  }
  const existingRequests = requests.find({ requestNumber: { $exists: false } })
  let requestsBackfilled = 0
  for await (const row of existingRequests) { await requests.updateOne({ _id: row._id }, { $set: { requestNumber: `REQ-MIG-${String(row._id).toUpperCase()}` } }); requestsBackfilled += 1 }
  const normalizedOrganizations = await organizations.updateMany({ 'subscription.source': 'bkash' }, { $set: { 'subscription.source': 'migration' } })

  await payments.createIndex({ paymentNumber: 1 }, { name: 'paymentNumber_1', unique: true })
  await payments.createIndex({ receiptNumber: 1 }, { name: 'receiptNumber_1', unique: true })
  await payments.dropIndex('request_status').catch(() => undefined)
  await payments.createIndex({ changeRequestId: 1, status: 1 }, { name: 'one_pending_payment_per_request', unique: true, partialFilterExpression: { changeRequestId: { $type: 'objectId' }, status: 'pending' } })
  await requests.createIndex({ requestNumber: 1 }, { name: 'requestNumber_1', unique: true })

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { backups, imported, paymentsBackfilled, requestsBackfilled, normalizedOrganizations: normalizedOrganizations.modifiedCount })
  console.log(`[${MIGRATION}] completed imported=${imported} paymentIds=${paymentsBackfilled} requestIds=${requestsBackfilled} sourceNormalized=${normalizedOrganizations.modifiedCount} manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
