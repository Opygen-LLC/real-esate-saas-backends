import { z } from 'zod'
import { TASK_TYPE_VALUES } from './taskType.contract'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must use YYYY-MM-DD')
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Due time must use HH:mm')
const taskTypeSchema = z.enum(TASK_TYPE_VALUES)

const createTaskBody = z.object({
  title: z.string({ required_error: 'Task title is required' }).trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  dueAt: z.string().datetime().optional(),
  dueDate: dateOnly.optional(),
  dueTime: timeOnly.optional(),
  taskType: taskTypeSchema.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled']).optional(),
  assignedAgent: z.string().optional(),
  linkedLead: z.string().optional(),
  linkedProperty: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.dueAt && !value.dueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueAt'], message: 'dueAt or dueDate is required' })
  }
  if (value.taskType === 'lead_follow_up' && !value.linkedLead) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkedLead'], message: 'Lead follow-up tasks require linkedLead' })
  }
  if (value.taskType === 'lead_follow_up' && !value.assignedAgent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assignedAgent'], message: 'Lead follow-up tasks require assignedAgent' })
  }
})

const updateTaskBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  dueAt: z.string().datetime().optional(),
  dueDate: dateOnly.optional(),
  dueTime: timeOnly.optional(),
  taskType: taskTypeSchema.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled']).optional(),
  assignedAgent: z.string().optional(),
  linkedLead: z.string().optional(),
  linkedProperty: z.string().optional(),
}).strict()

const createTaskZodSchema = z.object({ body: createTaskBody })
const updateTaskZodSchema = z.object({ body: updateTaskBody })

export const TaskValidation = {
  createTaskZodSchema,
  updateTaskZodSchema,
}
