import { z } from 'zod'
import { TASK_TYPE_VALUES } from './taskType.contract'
import { objectIdSchema, paginationQuerySchema } from '../../helpers/inputSecurity'

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
  assignedAgent: objectIdSchema.optional(),
  linkedLead: objectIdSchema.optional(),
  linkedProperty: objectIdSchema.optional(),
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
  assignedAgent: objectIdSchema.optional(),
  linkedLead: objectIdSchema.optional(),
  linkedProperty: objectIdSchema.optional(),
}).strict()

const taskIdParams = z.object({ id: objectIdSchema }).strict()
const createTaskZodSchema = z.object({ body: createTaskBody })
const updateTaskZodSchema = z.object({ params: taskIdParams, body: updateTaskBody })
const taskIdZodSchema = z.object({ params: taskIdParams })
const approveTaskZodSchema = z.object({ params: taskIdParams, body: z.object({ approvalStatus: z.enum(['approved', 'rejected']).default('approved') }).strict().default({ approvalStatus: 'approved' }) })
const listTasksZodSchema = z.object({ query: paginationQuerySchema.extend({
  sortBy: z.enum(['createdAt', 'updatedAt', 'dueAt', 'priority', 'status', 'approvalStatus', 'title']).optional(),
  searchTerm: z.string().trim().max(200).optional(),
  status: z.enum(['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  taskType: taskTypeSchema.optional(),
  assignedAgent: objectIdSchema.optional(),
  linkedLead: objectIdSchema.optional(),
  linkedProperty: objectIdSchema.optional(),
  dueDate: dateOnly.optional(),
  dueFrom: dateOnly.optional(),
  dueTo: dateOnly.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  scope: z.enum(['mine', 'team', 'all']).optional(),
}).strict() })

export const TaskValidation = {
  createTaskZodSchema,
  updateTaskZodSchema,
  taskIdZodSchema,
  approveTaskZodSchema,
  listTasksZodSchema,
}

