import { Types, type ClientSession } from 'mongoose'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { safeRegexPattern } from '../../helpers/searchQuery'
import { CrmService } from '../crm/crm.service'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { canManageTeamCrm, crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { Lead } from '../lead/lead.model'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { CRM_FOLLOW_UP_TIME_ZONE, getDayBoundsInTimeZone } from '../lead/leadFollowUpTime'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { userRefPopulate } from '../user/userProfile.service'
import { ITask, ITaskFilter, type ITaskMemberSummary, type ITaskSummaryResponse } from './task.interface'
import { Task } from './task.model'
import { isActiveTaskStatus, TASK_TYPE } from './taskType.contract'

const DHAKA_OFFSET = '+06:00'

const dueAtFromLegacy = (date: string, time = '09:00'): Date => {
  const value = new Date(`${date}T${time}:00${DHAKA_OFFSET}`)
  if (Number.isNaN(value.getTime())) throw new ApiError(400, 'Invalid task due date/time')
  return value
}

const legacyFieldsFromDueAt = (value: Date): { dueDate: string; dueTime: string } => {
  if (Number.isNaN(value.getTime())) throw new ApiError(400, 'Invalid task dueAt')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  return {
    dueDate: `${part('year')}-${part('month')}-${part('day')}`,
    dueTime: `${part('hour')}:${part('minute')}`,
  }
}

const normalizeDueFields = (payload: Partial<ITask>, existing?: ITask): Partial<ITask> => {
  const prepared: any = { ...payload }
  delete prepared.activeLeadFollowUpKey

  if (prepared.dueAt !== undefined) {
    const parsed = prepared.dueAt instanceof Date ? prepared.dueAt : new Date(prepared.dueAt)
    if (Number.isNaN(parsed.getTime())) throw new ApiError(400, 'Invalid task dueAt')
    prepared.dueAt = parsed
    Object.assign(prepared, legacyFieldsFromDueAt(parsed))
    return prepared
  }

  const dueDate = prepared.dueDate ?? existing?.dueDate
  const dueTime = prepared.dueTime ?? existing?.dueTime ?? '09:00'
  if (dueDate && (!existing || !existing.dueAt || prepared.dueDate !== undefined || prepared.dueTime !== undefined)) {
    prepared.dueAt = dueAtFromLegacy(dueDate, dueTime)
  } else if (!existing) {
    throw new ApiError(400, 'Task dueAt or dueDate is required')
  }

  return prepared
}

const assertTaskRelations = async (organizationId: string, task: Partial<ITask>, access?: CrmAccessContext) => {
  const checks: Promise<unknown>[] = []
  if (task.linkedLead) {
    checks.push((async () => {
      const lead = await Lead.exists({ _id: task.linkedLead, organizationId, ...crmMutationOwnerFilter('assignedAgent', access) })
      if (!lead) throw new ApiError(400, 'Linked lead must belong to this agency')
      await LeadEntitlementService.assertLeadAccessible(organizationId, String(task.linkedLead))
    })())
  }
  if (task.linkedProperty) {
    checks.push((async () => {
      const property = await Property.exists({ _id: task.linkedProperty, organizationId })
      if (!property) throw new ApiError(400, 'Linked property must belong to this agency')
    })())
  }
  if (task.assignedAgent) {
    checks.push(CrmAssignableMemberService.assertAssignableMember(organizationId, String(task.assignedAgent), 'task'))
  }
  await Promise.all(checks)

  if (task.taskType === TASK_TYPE.LEAD_FOLLOW_UP) {
    if (!task.linkedLead) throw new ApiError(400, 'Lead follow-up tasks require linkedLead')
    if (!task.assignedAgent) throw new ApiError(400, 'Lead follow-up tasks require assignedAgent')
  }
}

const scheduleReminder = async (task: ITask & { _id?: any }) => {
  if (!isActiveTaskStatus(task.status)) return
  const config: any = await CrmService.getConfig(task.organizationId)
  const runAt = new Date(task.dueAt.getTime() - (config.reminders?.taskMinutesBefore || 0) * 60_000)
  await OperationsQueueService.schedule({
    organizationId: task.organizationId,
    type: 'task_reminder',
    entityId: String(task._id),
    runAt,
    payload: { assignedAgent: task.assignedAgent?.toString() },
  })
}

const duplicateFollowUpError = (error: any): never => {
  if (error?.code === 11000 && (error?.keyPattern?.activeLeadFollowUpKey || error?.keyValue?.activeLeadFollowUpKey)) {
    throw new ApiError(409, 'This lead already has an active follow-up task')
  }
  throw error
}

const createTask = async (organizationId: string, payload: Partial<ITask>, actorId?: string, access?: CrmAccessContext): Promise<ITask> => {
  const prepared: any = normalizeDueFields({ ...payload, taskType: payload.taskType || TASK_TYPE.GENERAL })
  if (prepared.taskType === TASK_TYPE.LEAD_FOLLOW_UP) {
    throw new ApiError(400, 'Lead follow-up tasks must be scheduled through the Lead follow-up endpoint')
  }
  if (access && !canManageTeamCrm(access)) {
    if (prepared.assignedAgent && String(prepared.assignedAgent) !== access.userId) {
      throw new ApiError(403, 'Team members can only create tasks assigned to themselves')
    }
    prepared.assignedAgent = access.userId
  }
  await assertTaskRelations(organizationId, prepared, access)

  let result: any
  try {
    result = await Task.create({ ...prepared, organizationId })
  } catch (error) {
    duplicateFollowUpError(error)
  }

  await scheduleReminder(result)
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'task',
    aggregateId: result._id.toString(),
    eventType: 'task.created',
    leadId: result.linkedLead?.toString(),
    propertyId: result.linkedProperty?.toString(),
    actorId: actorId || result.assignedAgent?.toString(),
    payload: {
      summary: `Task created: ${result.title}`,
      dueAt: result.dueAt?.toISOString(),
      dueDate: result.dueDate,
      dueTime: result.dueTime,
      taskType: result.taskType,
      priority: result.priority,
    },
  })
  return result
}

const getAllTasks = async (
  filters: ITaskFilter,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<ITask[]>> => {
  const { searchTerm, organizationId, status, priority, taskType, assignedAgent, linkedLead, linkedProperty, dueDate, dueFrom, dueTo, overdue, approvalStatus } = filters
  const conditions: any[] = []
  if (organizationId) conditions.push({ organizationId })
  const ownerScope = crmReadOwnerFilter('assignedAgent', access)
  if (Object.keys(ownerScope).length) conditions.push(ownerScope)
  if (searchTerm) {
    const search = safeRegexPattern(searchTerm)
    conditions.push({ $or: ['title', 'description'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) })
  }
  if (status) conditions.push({ status })
  if (priority) conditions.push({ priority })
  if (taskType) conditions.push({ taskType })
  if (assignedAgent) conditions.push({ assignedAgent })
  if (linkedLead) conditions.push({ linkedLead })
  if (linkedProperty) conditions.push({ linkedProperty })
  if (dueDate) conditions.push({ dueDate })
  if (approvalStatus) conditions.push({ approvalStatus })
  const dueFromDate = dueFrom ? dueAtFromLegacy(dueFrom, '00:00') : undefined
  const dueToDate = dueTo ? new Date(dueAtFromLegacy(dueTo, '00:00').getTime() + 24 * 60 * 60 * 1000) : undefined
  if (dueFromDate && dueToDate && dueFromDate >= dueToDate) throw new ApiError(400, 'dueTo must be on or after dueFrom')
  if (dueFromDate || dueToDate) conditions.push({ dueAt: { ...(dueFromDate ? { $gte: dueFromDate } : {}), ...(dueToDate ? { $lt: dueToDate } : {}) } })
  if (overdue === true || overdue === 'true') conditions.push({ dueAt: { $lt: new Date() }, status: { $nin: ['Completed', 'Cancelled'] } })
  if (overdue === false || overdue === 'false') conditions.push({ $or: [{ dueAt: { $gte: new Date() } }, { status: { $in: ['Completed', 'Cancelled'] } }] })
  const where = conditions.length ? { $and: conditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)
  const allowedSort = new Set(['dueAt', 'createdAt', 'updatedAt', 'priority', 'status', 'approvalStatus', 'title'])
  const safeSortBy = allowedSort.has(sortBy) ? sortBy : 'dueAt'

  const dayBounds = getDayBoundsInTimeZone(new Date(), CRM_FOLLOW_UP_TIME_ZONE)
  const [result, summaryRows] = await Promise.all([
    Task.find(where)
      .populate(userRefPopulate('assignedAgent', 'name email userRole', { organizationId }))
      .populate({ path: 'linkedLead', select: 'name phone email', match: { organizationId, isLocked: { $ne: true } } })
      .populate({ path: 'linkedProperty', select: 'title price', match: { organizationId } })
      .sort(paginationHelper.buildStableSort(safeSortBy, sortOrder))
      .skip(skip)
      .limit(limit),
    Task.aggregate([
      { $match: where },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          dueToday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$dueAt', dayBounds.start] },
                    { $lt: ['$dueAt', dayBounds.endExclusive] },
                    { $ne: ['$status', 'Completed'] },
                    { $ne: ['$status', 'Cancelled'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$dueAt', dayBounds.start] }, { $ne: ['$status', 'Completed'] }, { $ne: ['$status', 'Cancelled'] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ])
  const summary = summaryRows[0] || { total: 0, completed: 0, dueToday: 0, overdue: 0 }
  const total = Number(summary.total || 0)
  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / Math.max(limit, 1)),
      summary: {
        completed: Number(summary.completed || 0),
        dueToday: Number(summary.dueToday || 0),
        overdue: Number(summary.overdue || 0),
      },
    },
    data: result,
  }
}


/**
 * Capability-filtered Tasks workload header. The roster is resolved once from
 * effective Lead permissions, then one aggregation keeps zero-workload members
 * visible without issuing per-member Lead queries.
 */
const getTaskSummary = async (
  organizationId: string,
  access: CrmAccessContext,
  referenceDate: Date = new Date(),
): Promise<ITaskSummaryResponse> => {
  const bounds = getDayBoundsInTimeZone(referenceDate, CRM_FOLLOW_UP_TIME_ZONE)
  const assignableLeadMembers = await CrmAssignableMemberService.listAssignableMembers(organizationId, 'lead')
  const assignableIds = assignableLeadMembers
    .map((member) => String(member._id))
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id))
  const memberMatch: Record<string, unknown> = {
    organizationId,
    status: 'active',
    _id: { $in: assignableIds },
  }

  if (access.scope === 'mine') {
    if (!Types.ObjectId.isValid(access.userId)) throw new ApiError(403, 'Authenticated CRM user context is invalid')
    memberMatch._id = new Types.ObjectId(access.userId)
  }

  const rows = await User.aggregate<ITaskMemberSummary>([
    { $match: memberMatch },
    {
      $lookup: {
        from: Lead.collection.name,
        let: { memberId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$organizationId', organizationId] },
                  { $eq: ['$assignedAgent', '$$memberId'] },
                  { $ne: ['$isConverted', true] },
                  { $ne: ['$isLocked', true] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              totalAssignedLeads: { $sum: 1 },
              dueToday: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: [{ $type: '$followUpDate' }, 'date'] }, { $gte: ['$followUpDate', bounds.start] }, { $lt: ['$followUpDate', bounds.endExclusive] }] },
                    1,
                    0,
                  ],
                },
              },
              overdueFollowUps: {
                $sum: {
                  $cond: [{ $and: [{ $eq: [{ $type: '$followUpDate' }, 'date'] }, { $lt: ['$followUpDate', bounds.start] }] }, 1, 0],
                },
              },
              upcomingFollowUps: {
                $sum: {
                  $cond: [{ $and: [{ $eq: [{ $type: '$followUpDate' }, 'date'] }, { $gte: ['$followUpDate', bounds.endExclusive] }] }, 1, 0],
                },
              },
            },
          },
        ],
        as: 'leadSummary',
      },
    },
    {
      $set: {
        leadSummary: {
          $ifNull: [
            { $arrayElemAt: ['$leadSummary', 0] },
            { totalAssignedLeads: 0, dueToday: 0, overdueFollowUps: 0, upcomingFollowUps: 0 },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        memberId: { $toString: '$_id' },
        memberName: '$name',
        role: '$userRole',
        totalAssignedLeads: '$leadSummary.totalAssignedLeads',
        dueToday: '$leadSummary.dueToday',
        overdueFollowUps: '$leadSummary.overdueFollowUps',
        upcomingFollowUps: '$leadSummary.upcomingFollowUps',
      },
    },
    { $sort: { memberName: 1, memberId: 1 } },
  ])

  const totals: ITaskSummaryResponse['totals'] = rows.reduce(
    (acc: ITaskSummaryResponse['totals'], row: ITaskMemberSummary) => ({
      totalAssignedLeads: acc.totalAssignedLeads + Number(row.totalAssignedLeads || 0),
      dueToday: acc.dueToday + Number(row.dueToday || 0),
      overdueFollowUps: acc.overdueFollowUps + Number(row.overdueFollowUps || 0),
      upcomingFollowUps: acc.upcomingFollowUps + Number(row.upcomingFollowUps || 0),
    }),
    { totalAssignedLeads: 0, dueToday: 0, overdueFollowUps: 0, upcomingFollowUps: 0 },
  )

  return {
    scope: access.scope,
    day: {
      timeZone: bounds.timeZone,
      localDate: bounds.localDate,
      start: bounds.start.toISOString(),
      end: bounds.endInclusive.toISOString(),
    },
    totals,
    members: rows,
  }
}

const updateTask = async (
  organizationId: string,
  id: string,
  payload: Partial<ITask>,
  actorId?: string,
  access?: CrmAccessContext,
): Promise<ITask | null> => {
  const task: any = await Task.findOne({ _id: id, organizationId, ...crmMutationOwnerFilter('assignedAgent', access) }).select('+activeLeadFollowUpKey')
  if (!task) throw new ApiError(httpStatus.NOT_FOUND, 'Task not found')

  const schedulingFields = ['dueAt', 'dueDate', 'dueTime', 'assignedAgent', 'linkedLead', 'taskType'] as const
  const attemptsSchedulingMutation = schedulingFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))
  if ((task.taskType === TASK_TYPE.LEAD_FOLLOW_UP || payload.taskType === TASK_TYPE.LEAD_FOLLOW_UP) && attemptsSchedulingMutation) {
    throw new ApiError(400, 'Lead follow-up scheduling fields must be changed through the Lead follow-up endpoint')
  }

  const previousStatus = task.status
  const prepared: any = normalizeDueFields(payload, task)
  if (access && !canManageTeamCrm(access) && prepared.assignedAgent !== undefined && String(prepared.assignedAgent) !== access.userId) {
    throw new ApiError(403, 'Team members cannot reassign tasks to another member')
  }
  const relationCandidate = {
    taskType: prepared.taskType ?? task.taskType,
    linkedLead: prepared.linkedLead ?? task.linkedLead,
    assignedAgent: prepared.assignedAgent ?? task.assignedAgent,
    linkedProperty: prepared.linkedProperty ?? task.linkedProperty,
  }
  await assertTaskRelations(organizationId, relationCandidate, access)

  Object.assign(task, prepared)
  if (prepared.status === 'Completed' && !task.completedAt) task.completedAt = new Date()
  if (prepared.status && prepared.status !== 'Completed') task.completedAt = undefined

  try {
    await task.save()
  } catch (error) {
    duplicateFollowUpError(error)
  }

  if (['Completed', 'Cancelled'].includes(task.status)) {
    await OperationsQueueService.cancel(organizationId, 'task_reminder', id)
  } else if (prepared.dueAt || prepared.dueDate || prepared.dueTime || prepared.status) {
    await scheduleReminder(task)
  }

  const eventType = task.status === 'Completed' && previousStatus !== 'Completed' ? 'task.completed' : 'task.updated'
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'task',
    aggregateId: id,
    eventType,
    leadId: task.linkedLead?.toString(),
    propertyId: task.linkedProperty?.toString(),
    actorId,
    payload: { summary: `Task ${task.status}: ${task.title}`, status: task.status, taskType: task.taskType, dueAt: task.dueAt?.toISOString() },
  })

  await task.populate(userRefPopulate('assignedAgent', 'name email userRole', { organizationId }))
  await task.populate({ path: 'linkedLead', select: 'name phone email', match: { organizationId, isLocked: { $ne: true } } })
  await task.populate({ path: 'linkedProperty', select: 'title price', match: { organizationId } })
  return task
}

/**
 * Transaction-aware lifecycle helper. Unlike the public Task CRUD path, this is
 * only used by LeadLifecycleService to keep Lead.followUpDate and the generated
 * lead_follow_up Task in the same Mongo transaction.
 */
const syncLeadFollowUpTask = async (input: {
  organizationId: string
  leadId: string
  assignedAgent: string
  dueAt: Date
  title?: string
  description?: string
  priority?: ITask['priority']
}, session?: ClientSession): Promise<ITask> => {
  const dueAt = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt)
  if (Number.isNaN(dueAt.getTime())) throw new ApiError(400, 'Invalid lead follow-up dueAt')
  const legacy = legacyFieldsFromDueAt(dueAt)
  const activeLeadFollowUpKey = `${input.organizationId}:${input.leadId}`
  const update = {
    $set: {
      title: input.title || 'Lead follow-up',
      description: input.description || '',
      dueAt,
      ...legacy,
      taskType: TASK_TYPE.LEAD_FOLLOW_UP,
      priority: input.priority || 'medium',
      status: 'Pending',
      assignedAgent: input.assignedAgent,
      linkedLead: input.leadId,
      activeLeadFollowUpKey,
    },
    $setOnInsert: {
      organizationId: input.organizationId,
      approvalStatus: 'pending',
    },
  }
  try {
    let query = Task.findOneAndUpdate(
      { activeLeadFollowUpKey },
      update,
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
    if (session) query = query.session(session)

    const task = await query.exec()
    if (!task) throw new ApiError(500, 'Failed to create or update the lead follow-up task')
    return task.toObject()
  } catch (error) {
    return duplicateFollowUpError(error)
  }
}

const cancelActiveLeadFollowUps = async (
  organizationId: string,
  leadId: string,
  session?: ClientSession,
): Promise<string[]> => {
  let query = Task.find({
    organizationId,
    linkedLead: leadId,
    taskType: TASK_TYPE.LEAD_FOLLOW_UP,
    status: { $in: ['Pending', 'InProgress', 'Overdue'] },
  }).select('_id')
  if (session) query = query.session(session)
  const tasks: any[] = await query.lean()
  if (!tasks.length) return []
  const ids = tasks.map((task) => task._id)
  await Task.updateMany(
    { _id: { $in: ids }, organizationId },
    { $set: { status: 'Cancelled' }, $unset: { activeLeadFollowUpKey: 1 } },
    session ? { session } : undefined,
  )
  return ids.map(String)
}

const reassignActiveLeadFollowUp = async (
  organizationId: string,
  leadId: string,
  assignedAgent: string,
  session?: ClientSession,
): Promise<string[]> => {
  const filter = {
    organizationId,
    linkedLead: leadId,
    taskType: TASK_TYPE.LEAD_FOLLOW_UP,
    status: { $in: ['Pending', 'InProgress', 'Overdue'] },
  }
  let query = Task.find(filter).select('_id')
  if (session) query = query.session(session)
  const tasks: any[] = await query.lean()
  if (!tasks.length) return []
  await Task.updateMany(filter, { $set: { assignedAgent } }, session ? { session } : undefined)
  return tasks.map((task) => String(task._id))
}

const refreshTaskReminders = async (organizationId: string, taskIds: string[]) => {
  for (const id of [...new Set(taskIds)]) {
    const task: any = await Task.findOne({ _id: id, organizationId })
    if (!task || !isActiveTaskStatus(task.status)) {
      await OperationsQueueService.cancel(organizationId, 'task_reminder', id)
      continue
    }
    await OperationsQueueService.cancel(organizationId, 'task_reminder', id)
    await scheduleReminder(task)
  }
}

const cancelTaskReminders = async (organizationId: string, taskIds: string[]) => {
  await Promise.all([...new Set(taskIds)].map((id) => OperationsQueueService.cancel(organizationId, 'task_reminder', id)))
}

const deleteTask = async (organizationId: string, id: string, access?: CrmAccessContext) => {
  const result = await Task.findOneAndDelete({ _id: id, organizationId, ...crmMutationOwnerFilter('assignedAgent', access) })
  if (!result) throw new ApiError(404, 'Task not found')
  await OperationsQueueService.cancel(organizationId, 'task_reminder', id)
  return result
}

const approveTask = async (organizationId: string, id: string, userId: string, approvalStatus: 'approved' | 'rejected') => {
  const result = await Task.findOneAndUpdate(
    { _id: id, organizationId },
    { approvalStatus, approvedBy: userId, approvedAt: new Date() },
    { new: true },
  )
    .populate(userRefPopulate('assignedAgent', 'name email userRole', { organizationId }))
    .populate(userRefPopulate('approvedBy', 'name email userRole', { organizationId }))
  if (!result) throw new ApiError(404, 'Task not found')
  return result
}

export const TaskService = { createTask, getAllTasks, getTaskSummary, updateTask, syncLeadFollowUpTask, cancelActiveLeadFollowUps, reassignActiveLeadFollowUp, refreshTaskReminders, cancelTaskReminders, deleteTask, approveTask }
