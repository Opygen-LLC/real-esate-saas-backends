import mongoose from 'mongoose'
import config from '../../config'
import { Viewing } from '../module/viewing/viewing.model'
import { ACTIVE_VIEWING_STATUSES, viewingWindowsOverlap } from '../module/viewing/viewingWindow'
import { FinanceInvoice, FinanceTransaction } from '../module/finance/finance.model'
import { FinanceJournalEntry } from '../module/finance/financeAccounting.model'
import { OperationsJob } from '../module/operationsQueue/operationsJob.model'

// Read-only: IDs and counts only. Never log visitor identities, passwords or URLs.
async function main() {
  await mongoose.connect(config.database_url as string, { autoIndex: false, autoCreate: false })
  const findings: Array<Record<string, unknown>> = []
  let count = 0
  const record = (finding: Record<string, unknown>) => { count += 1; if (findings.length < 500) findings.push(finding) }
  let bucket = ''; let active: any[] = []
  const cursor = Viewing.find({ status: { $in: [...ACTIVE_VIEWING_STATUSES] } })
    .select('_id organizationId date startTime endTime agentId propertyId').sort({ organizationId: 1, date: 1, startTime: 1 }).lean().cursor()
  for await (const row of cursor) {
    const nextBucket = `${row.organizationId}:${row.date}`
    if (nextBucket !== bucket) { active = []; bucket = nextBucket }
    active = active.filter((previous) => previous.endTime > row.startTime)
    for (const previous of active) if ((String(previous.agentId) === String(row.agentId) || String(previous.propertyId) === String(row.propertyId)) &&
        viewingWindowsOverlap(previous.startTime, previous.endTime, row.startTime, row.endTime)) {
      record({ kind: 'overlapping_viewings', organizationId: row.organizationId, ids: [String(previous._id), String(row._id)] })
    }
    active.push(row)
  }
  for await (const invoice of FinanceInvoice.find({ archivedAt: { $ne: null }, $or: [{ paidAmount: { $gt: 0 } }, { 'payments.0': { $exists: true } }] }).select('_id organizationId').lean().cursor()) {
    record({ kind: 'archived_invoice_with_payment_history', organizationId: invoice.organizationId, id: String(invoice._id) })
  }
  for await (const transaction of FinanceTransaction.find({ accountingJournalId: { $ne: null }, $or: [{ status: 'voided' }, { deletedAt: { $ne: null } }] }).select('_id organizationId accountingJournalId').lean().cursor()) {
    const journal = await FinanceJournalEntry.findOne({ _id: transaction.accountingJournalId, organizationId: transaction.organizationId }).select('status').lean()
    if (!journal || journal.status !== 'REVERSED') record({ kind: 'hidden_or_voided_transaction_without_reversal', organizationId: transaction.organizationId, id: String(transaction._id) })
  }
  const failedOutbox = await OperationsJob.countDocuments({ type: { $in: ['calendar_sync', 'calendar_delete', 'domain_event_publish', 'viewing_reminder'] }, status: 'failed' })
  console.log(JSON.stringify({ readOnly: true, findingCount: count, findings, sampleLimited: count > findings.length, failedOutboxJobs: failedOutbox }, null, 2))
  if (process.argv.includes('--fail-on-findings') && (count || failedOutbox)) process.exitCode = 2
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }).finally(() => mongoose.disconnect())
