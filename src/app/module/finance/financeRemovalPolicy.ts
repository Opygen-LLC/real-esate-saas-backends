import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { effectivePermissionsForUser } from '../user/accessControl'

export type RemovalActor = { id: string; role?: string }

export const assertRemovalActor = (actor: RemovalActor): void => {
  if (actor.role !== 'agency_owner') throw new ApiError(403, 'Only the agency owner can remove finance records', '', 'FINANCE_REMOVAL_FORBIDDEN')
}

/** Do not trust a caller-supplied role or an old JWT after ownership changes. */
export const assertFinanceRemovalOwner = async (organizationId: string, actor: RemovalActor, session?: ClientSession): Promise<void> => {
  assertRemovalActor(actor)
  const userQuery = User.findOne({ _id: actor.id, organizationId }).select('userRole status')
  // A real write conflicts with concurrent ownership transfers before removal.
  const organizationQuery = session
    ? Organization.findOneAndUpdate({ organizationId }, { $inc: { financeMutationVersion: 1 } }, { session, new: true }).select('ownerId isBlocked')
    : Organization.findOne({ organizationId }).select('ownerId isBlocked')
  if (session) { userQuery.session(session); organizationQuery.session(session) }
  const user: any = await userQuery.lean()
  const organization: any = await organizationQuery.lean()
  if (!user || user.status !== 'active' || !organization || organization.isBlocked ||
      String(organization.ownerId) !== String(actor.id) || user.userRole !== 'agency_owner' ||
      !effectivePermissionsForUser(user).includes('finance.delete')) {
    throw new ApiError(403, 'Only the current agency owner can remove finance records', '', 'FINANCE_REMOVAL_FORBIDDEN')
  }
}

export const assertManualTransaction = (transaction: { sourceType?: string }): void => {
  if (transaction.sourceType !== 'manual') throw new ApiError(409, 'Linked transactions must be managed from their source record', '', 'FINANCE_LINKED_TRANSACTION')
}

export const assertTransactionRemovable = (transaction: { sourceType?: string; status: string }): void => {
  assertManualTransaction(transaction)
  if (transaction.status !== 'voided') throw new ApiError(409, 'Void the transaction before removing it', '', 'FINANCE_VOID_REQUIRED')
}

export const assertInvoiceRemovable = (invoice: { status: string; paidAmount?: number; payments?: unknown[] }): void => {
  if (!['draft', 'cancelled'].includes(invoice.status)) throw new ApiError(409, 'Only draft or voided invoices can be removed', '', 'FINANCE_INVOICE_LIFECYCLE')
  if (Number(invoice.paidAmount || 0) !== 0 || (invoice.payments || []).length) throw new ApiError(409, 'Invoices with payment history cannot be removed', '', 'FINANCE_PAYMENT_HISTORY')
}

export const assertCommissionRemovable = (commission: { status: string; paidAt?: unknown; payoutTransactionId?: unknown; payoutJournalId?: unknown }): void => {
  if (commission.status !== 'cancelled' || commission.paidAt || commission.payoutTransactionId || commission.payoutJournalId) {
    throw new ApiError(409, 'Only cancelled commissions without payout history can be removed', '', 'FINANCE_COMMISSION_LIFECYCLE')
  }
}
