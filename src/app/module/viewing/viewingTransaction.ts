import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { requiredTransaction } from '../../db/requiredTransaction'
import { Organization } from '../organization/organization.model'
import { evaluateTenantAccessOrganization } from '../tenantAccess/tenantAccess.policy'

/**
 * A shared tenant document is written BEFORE reading appointment availability.
 * Competing API replicas therefore conflict and retry against a fresh snapshot.
 * This prevents write skew for arbitrary overlapping intervals, not only equal
 * start times. All create, update, reactivation and delete paths use this guard.
 * Tenant-wide serialization is intentional; independent tenants do not contend.
 */
export const viewingTransaction = <T>(organizationId: string, work: (session: ClientSession, organization: any) => Promise<T>, publicWrite = false): Promise<T> =>
  requiredTransaction(async (session) => {
    const organization: any = await Organization.findOneAndUpdate(
      { organizationId, 'platformAccess.status': { $ne: 'pending_deletion' } },
      { $inc: { viewingMutationVersion: 1 } },
      { session, new: true },
    )
    if (!organization) throw new ApiError(423, 'Agency is unavailable for writes', '', 'TENANT_UNAVAILABLE')
    const access = evaluateTenantAccessOrganization(organization)
    if (publicWrite ? !access.publicWritesAllowed : !access.workspaceAllowed) {
      throw new ApiError(403, 'Agency is not accepting viewing changes', '', 'TENANT_ACCESS_INACTIVE')
    }
    return work(session, organization)
  })
