import { z } from 'zod'

const createTaskZodSchema = z.object({
  body: z.object({
    title: z.string({ required_error: 'Task title is required' }),
    description: z.string().optional(),
    dueDate: z.string({ required_error: 'Due date is required' }),
    dueTime: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z.enum(['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled']).optional(),
    assignedAgent: z.string().optional(),
    linkedLead: z.string().optional(),
    linkedProperty: z.string().optional(),
  }),
})

const updateTaskZodSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    dueDate: z.string().optional(),
    dueTime: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z.enum(['Pending', 'InProgress', 'Completed', 'Overdue', 'Cancelled']).optional(),
    assignedAgent: z.string().optional(),
    linkedLead: z.string().optional(),
    linkedProperty: z.string().optional(),
  }),
})

export const TaskValidation = {
  createTaskZodSchema,
  updateTaskZodSchema,
}
