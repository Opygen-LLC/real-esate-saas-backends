import { Schema, model } from 'mongoose'
import { ITask, TaskModel } from './task.interface'
import { isActiveTaskStatus, TASK_TYPE, TASK_TYPE_VALUES } from './taskType.contract'

const taskSchema = new Schema<ITask, TaskModel>(
  {
    organizationId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    dueAt: { type: Date, required: true, index: true },
    dueDate: { type: String, required: true },
    dueTime: { type: String, default: '09:00' },
    taskType: { type: String, enum: TASK_TYPE_VALUES, default: TASK_TYPE.GENERAL, required: true, index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: String, enum: ['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled'], default: 'Pending' },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    assignedAgent: { type: Schema.Types.ObjectId, ref: 'User' },
    linkedLead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    linkedProperty: { type: Schema.Types.ObjectId, ref: 'Property' },
    completedAt: { type: Date },
    activeLeadFollowUpKey: { type: String, select: false },
  },
  { timestamps: true }
)

taskSchema.pre('validate', function (this: any) {
  if (this.taskType === TASK_TYPE.LEAD_FOLLOW_UP && isActiveTaskStatus(this.status)) {
    if (!this.linkedLead) this.invalidate('linkedLead', 'Lead follow-up tasks must be linked to a lead')
    if (!this.assignedAgent) this.invalidate('assignedAgent', 'Lead follow-up tasks must be assigned to a team member')
    if (this.organizationId && this.linkedLead) {
      this.activeLeadFollowUpKey = `${String(this.organizationId)}:${String(this.linkedLead)}`
    }
  } else {
    this.activeLeadFollowUpKey = undefined
  }
})

taskSchema.index({ organizationId: 1, dueDate: 1, status: 1 })
taskSchema.index({ organizationId: 1, assignedAgent: 1, status: 1 })
taskSchema.index({ organizationId: 1, dueAt: 1, status: 1 }, { name: 'task_tenant_dueat_status' })
taskSchema.index({ organizationId: 1, taskType: 1, assignedAgent: 1, dueAt: 1 }, { name: 'task_tenant_type_assignee_dueat' })
taskSchema.index({ organizationId: 1, linkedLead: 1, taskType: 1, status: 1 }, { name: 'task_tenant_lead_type_status' })
taskSchema.index({ organizationId: 1, linkedLead: 1, taskType: 1, status: 1, dueAt: 1 }, { name: 'task_tenant_lead_type_status_dueat' })
taskSchema.index(
  { activeLeadFollowUpKey: 1 },
  {
    name: 'task_active_lead_followup_unique',
    unique: true,
    sparse: true,
  },
)

export const Task = model<ITask, TaskModel>('Task', taskSchema)
