import { Types } from 'mongoose'
import ApiError from '../../errors/ApiError'

export const tenantResourceFilter = (organizationId: string, id: string | Types.ObjectId) => {
  if (!organizationId) throw new ApiError(403, 'Tenant context required')
  return { organizationId, _id: id }
}
