import mongoose, { Model } from 'mongoose'

export type ITaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Overdue' | 'Cancelled'
export type ITaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type IApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ITask {
  organizationId: string
  title: string
  description?: string
  dueDate: string
  dueTime?: string
  priority: ITaskPriority
  status: ITaskStatus
  approvalStatus?: IApprovalStatus
  approvedBy?: mongoose.Types.ObjectId | string
  approvedAt?: Date
  assignedAgent?: mongoose.Types.ObjectId | string
  linkedLead?: mongoose.Types.ObjectId | string
  linkedProperty?: mongoose.Types.ObjectId | string
  completedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

export type ITaskFilter = {
  searchTerm?: string
  organizationId?: string
  status?: string
  priority?: string
  assignedAgent?: string
  linkedLead?: string
  linkedProperty?: string
  dueDate?: string
}

export type TaskModel = Model<ITask>
