import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { IActivity } from './activity.interface'
import { Activity } from './activity.model'

const createActivity = async (
  organizationId: string,
  payload: Partial<IActivity>
): Promise<IActivity> => {
  const result = await Activity.create({
    ...payload,
    organizationId,
  })
  return result
}

const getActivitiesByLead = async (
  organizationId: string,
  leadId: string,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IActivity[]>> => {
  const { page, limit, skip } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Activity.find({ organizationId, leadId })
    .populate('agentId', 'name email profileImgURL')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)

  const total = await Activity.countDocuments({ organizationId, leadId })

  return {
    meta: { page, limit, total },
    data: result,
  }
}

export const ActivityService = {
  createActivity,
  getActivitiesByLead,
}
