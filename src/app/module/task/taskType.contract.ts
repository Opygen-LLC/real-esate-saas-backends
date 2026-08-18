export const TASK_TYPE_VALUES = ['lead_follow_up', 'general', 'viewing_related'] as const
export type TaskType = (typeof TASK_TYPE_VALUES)[number]

export const TASK_TYPE = {
  LEAD_FOLLOW_UP: 'lead_follow_up',
  GENERAL: 'general',
  VIEWING_RELATED: 'viewing_related',
} as const satisfies Record<string, TaskType>

export const ACTIVE_TASK_STATUSES = ['Pending', 'InProgress', 'Overdue'] as const
export const isActiveTaskStatus = (status: unknown): boolean =>
  ACTIVE_TASK_STATUSES.includes(status as (typeof ACTIVE_TASK_STATUSES)[number])
