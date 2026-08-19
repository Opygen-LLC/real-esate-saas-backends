import mongoose, { Model } from 'mongoose'
import type { TaskType } from './taskType.contract'

export type ITaskStatus = 'Pending' | 'InProgress' | 'Completed' | 'Overdue' | 'Cancelled'
export type ITaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type IApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ITask {
  organizationId: string
  title: string
  description?: string

  /** Canonical deadline timestamp. */
  dueAt: Date
  /** Legacy UI/storage compatibility. Keep until task clients are fully migrated. */
  dueDate: string
  dueTime?: string

  taskType: TaskType
  priority: ITaskPriority
  status: ITaskStatus
  approvalStatus?: IApprovalStatus
  approvedBy?: mongoose.Types.ObjectId | string
  approvedAt?: Date
  assignedAgent?: mongoose.Types.ObjectId | string
  linkedLead?: mongoose.Types.ObjectId | string
  linkedProperty?: mongoose.Types.ObjectId | string
  completedAt?: Date

  /** Internal concurrency guard for one active generated follow-up per lead. */
  activeLeadFollowUpKey?: string

  createdAt?: Date
  updatedAt?: Date
}

export type ITaskFilter = {
  searchTerm?: string
  organizationId?: string
  status?: string
  priority?: string
  taskType?: string
  assignedAgent?: string
  linkedLead?: string
  linkedProperty?: string
  dueDate?: string
  dueFrom?: string
  dueTo?: string
  overdue?: boolean | string
  approvalStatus?: string
  scope?: 'mine' | 'team'
}

export type TaskModel = Model<ITask>


export interface ITaskMemberSummary {
  memberId: string
  memberName: string
  role: string
  totalAssignedLeads: number
  dueToday: number
  overdueFollowUps: number
  upcomingFollowUps: number
}

export interface ITaskSummaryResponse {
  scope: 'mine' | 'team'
  day: {
    timeZone: string
    localDate: string
    start: string
    end: string
  }
  totals: Omit<ITaskMemberSummary, 'memberId' | 'memberName' | 'role'>
  members: ITaskMemberSummary[]
}
