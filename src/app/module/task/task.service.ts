import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { ITask, ITaskFilter } from './task.interface'
import { Task } from './task.model'

const createTask = async (
  organizationId: string,
  payload: Partial<ITask>
): Promise<ITask> => {
  const result = await Task.create({
    ...payload,
    organizationId,
  })
  return result
}

const getAllTasks = async (
  filters: ITaskFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<ITask[]>> => {
  const { searchTerm, organizationId, status, priority, assignedAgent, linkedLead, linkedProperty, dueDate } =
    filters
  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId) andConditions.push({ organizationId })

  if (searchTerm) {
    andConditions.push({
      $or: ['title', 'description'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (status) andConditions.push({ status })
  if (priority) andConditions.push({ priority })
  if (assignedAgent) andConditions.push({ assignedAgent })
  if (linkedLead) andConditions.push({ linkedLead })
  if (linkedProperty) andConditions.push({ linkedProperty })
  if (dueDate) andConditions.push({ dueDate })

  const whereCondition = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Task.find(whereCondition)
    .populate('assignedAgent', 'name email profileImgURL')
    .populate('linkedLead', 'name phone email')
    .populate('linkedProperty', 'title price')
    .sort({ dueDate: 1, [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await Task.countDocuments(whereCondition)

  return {
    meta: { page, limit, total },
    data: result,
  }
}

const updateTask = async (
  organizationId: string,
  id: string,
  payload: Partial<ITask>
): Promise<ITask | null> => {
  if (payload.status === 'Completed' && !payload.completedAt) {
    payload.completedAt = new Date()
  }

  const result = await Task.findOneAndUpdate({ _id: id, organizationId }, payload, {
    new: true,
  })
    .populate('assignedAgent', 'name email profileImgURL')
    .populate('linkedLead', 'name phone email')
    .populate('linkedProperty', 'title price')

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Task not found')
  }
  return result
}

const deleteTask = async (organizationId: string, id: string): Promise<ITask | null> => {
  const result = await Task.findOneAndDelete({ _id: id, organizationId })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Task not found')
  }
  return result
}

export const TaskService = {
  createTask,
  getAllTasks,
  updateTask,
  deleteTask,
}
