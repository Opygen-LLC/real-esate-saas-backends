import { Schema, model } from 'mongoose'
import { ITask, TaskModel } from './task.interface'

const taskSchema = new Schema<ITask, TaskModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    dueDate: {
      type: String,
      required: true,
    },
    dueTime: {
      type: String,
      default: '09:00',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled'],
      default: 'Pending',
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    linkedLead: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
    },
    linkedProperty: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
)

taskSchema.index({ organizationId: 1, dueDate: 1, status: 1 })
taskSchema.index({ organizationId: 1, assignedAgent: 1, status: 1 })

export const Task = model<ITask, TaskModel>('Task', taskSchema)
