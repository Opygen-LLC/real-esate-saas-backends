import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'

const PURGING_STATUS = 'pending_deletion'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const purgeBlockedError = () => new ApiError(
  423,
  'This organization is being permanently deleted and can no longer accept writes',
  '',
  'TENANT_PURGING',
)

const assertTenantWritable = async (organizationId: string): Promise<void> => {
  const normalized = String(organizationId || '').trim()
  if (!normalized || normalized === '__platform__') return
  const organization: any = await Organization.findOne({ organizationId: normalized })
    .select('organizationId platformAccess.status')
    .lean()
  if (!organization) throw new ApiError(404, 'Organization not found')
  if (String(organization.platformAccess?.status || '') === PURGING_STATUS) throw purgeBlockedError()
}

const assertRequestWritable = async (method: string, organizationId?: string): Promise<void> => {
  if (SAFE_METHODS.has(String(method || '').toUpperCase())) return
  if (!organizationId) return
  await assertTenantWritable(organizationId)
}

const isPurging = async (organizationId: string): Promise<boolean> => Boolean(await Organization.exists({
  organizationId,
  'platformAccess.status': PURGING_STATUS,
}))

export const TenantPurgeBarrier = {
  PURGING_STATUS,
  assertTenantWritable,
  assertRequestWritable,
  isPurging,
}
