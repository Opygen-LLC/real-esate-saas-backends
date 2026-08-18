import mongoose from 'mongoose'
import config from '../../config'
import { CrmConfig } from '../module/crm/crm.model'
import { Lead } from '../module/lead/lead.model'
import { LEAD_STATUS } from '../module/lead/leadStatus.contract'
import { OperationsQueueService } from '../module/operationsQueue/operationsQueue.service'
import { Task } from '../module/task/task.model'
import { ACTIVE_TASK_STATUSES, TASK_TYPE } from '../module/task/taskType.contract'
import { User } from '../module/user/user.model'

const dhakaLegacyFields = (dueAt: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(dueAt)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  return {
    dueDate: `${part('year')}-${part('month')}-${part('day')}`,
    dueTime: `${part('hour')}:${part('minute')}`,
  }
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  // Validate the complete source-of-truth set before writing anything. A scheduled
  // follow-up without an owner cannot produce a valid assigned Task, and silently
  // guessing an owner would corrupt responsibility/audit semantics.
  const candidateLeads: any[] = await Lead.find({
    isConverted: { $ne: true },
    followUpDate: { $exists: true, $ne: null },
  })
    .select('_id organizationId name followUpDate assignedAgent leadStatus')
    .lean()

  const missingDates: string[] = (await Lead.find({
    isConverted: { $ne: true },
    leadStatus: LEAD_STATUS.FOLLOW_UP_SCHEDULED,
    $or: [{ followUpDate: { $exists: false } }, { followUpDate: null }],
  }).select('_id').lean()).map((lead: any) => String(lead._id))

  const invalidDates: string[] = []
  const missingAssignees: string[] = []
  for (const lead of candidateLeads) {
    const dueAt = lead.followUpDate instanceof Date ? lead.followUpDate : new Date(lead.followUpDate)
    if (Number.isNaN(dueAt.getTime())) invalidDates.push(String(lead._id))
    if (!lead.assignedAgent) missingAssignees.push(String(lead._id))
  }

  const assignedRefs = candidateLeads
    .filter((lead) => lead.assignedAgent)
    .map((lead) => ({ organizationId: String(lead.organizationId), userId: String(lead.assignedAgent) }))
  const userIds = [...new Set(assignedRefs.map((item) => item.userId))]
  const users: any[] = userIds.length
    ? await User.find({ _id: { $in: userIds }, status: 'active' }).select('_id organizationId').lean()
    : []
  const activeMembers = new Set(users.map((user) => `${String(user.organizationId)}:${String(user._id)}`))
  const invalidAssignees = assignedRefs
    .filter((item) => !activeMembers.has(`${item.organizationId}:${item.userId}`))
    .map((item) => item.userId)

  const blockers = [
    missingDates.length ? `FollowUpScheduled Leads missing followUpDate: ${missingDates.slice(0, 20).join(', ')}` : '',
    invalidDates.length ? `Leads with invalid followUpDate: ${invalidDates.slice(0, 20).join(', ')}` : '',
    missingAssignees.length ? `Leads with followUpDate but no assignedAgent: ${missingAssignees.slice(0, 20).join(', ')}` : '',
    invalidAssignees.length ? `Follow-up assignees that are missing/inactive/cross-agency: ${[...new Set(invalidAssignees)].slice(0, 20).join(', ')}` : '',
  ].filter(Boolean)

  if (blockers.length) {
    throw new Error(`CRM Phase 6 follow-up reconciliation stopped before writes. Resolve these data issues and rerun:\n- ${blockers.join('\n- ')}`)
  }

  const reminderMinutesByOrg = new Map<string, number>()
  const reminderMinutes = async (organizationId: string) => {
    const cached = reminderMinutesByOrg.get(organizationId)
    if (cached !== undefined) return cached
    const crm: any = await CrmConfig.findOne({ organizationId }).select('reminders.taskMinutesBefore').lean()
    const value = Math.max(0, Number(crm?.reminders?.taskMinutesBefore ?? 30))
    reminderMinutesByOrg.set(organizationId, value)
    return value
  }

  let created = 0
  let updated = 0
  let cancelled = 0
  let remindersScheduled = 0

  // Lead.followUpDate is canonical. Reconcile exactly one active generated task to it.
  for (const lead of candidateLeads) {
    const organizationId = String(lead.organizationId)
    const leadId = String(lead._id)
    const assignedAgent = String(lead.assignedAgent)
    const dueAt = lead.followUpDate instanceof Date ? lead.followUpDate : new Date(lead.followUpDate)
    const activeLeadFollowUpKey = `${organizationId}:${leadId}`
    const legacy = dhakaLegacyFields(dueAt)

    let task: any = await Task.findOne({
      organizationId,
      linkedLead: lead._id,
      taskType: TASK_TYPE.LEAD_FOLLOW_UP,
      status: { $in: ACTIVE_TASK_STATUSES },
    }).select('+activeLeadFollowUpKey')

    if (task) {
      task.assignedAgent = lead.assignedAgent
      task.dueAt = dueAt
      task.dueDate = legacy.dueDate
      task.dueTime = legacy.dueTime
      task.activeLeadFollowUpKey = activeLeadFollowUpKey
      if (!task.title?.trim()) task.title = `Follow up with ${lead.name}`
      await task.save()
      updated += 1
    } else {
      task = await Task.create({
        organizationId,
        title: `Follow up with ${lead.name}`,
        description: 'Backfilled from canonical Lead.followUpDate',
        dueAt,
        ...legacy,
        taskType: TASK_TYPE.LEAD_FOLLOW_UP,
        priority: 'medium',
        status: 'Pending',
        approvalStatus: 'pending',
        assignedAgent: lead.assignedAgent,
        linkedLead: lead._id,
        activeLeadFollowUpKey,
      })
      created += 1
    }

    await OperationsQueueService.cancel(organizationId, 'task_reminder', String(task._id))
    const runAt = new Date(dueAt.getTime() - (await reminderMinutes(organizationId)) * 60_000)
    if (runAt.getTime() > Date.now()) {
      await OperationsQueueService.schedule({
        organizationId,
        type: 'task_reminder',
        entityId: String(task._id),
        runAt,
        payload: { assignedAgent },
      })
      remindersScheduled += 1
    }
  }

  // Cancel generated tasks that no longer have a canonical open-Lead follow-up.
  // Historical task rows are kept; only their active slot/reminder is retired.
  const activeTasks: any[] = await Task.find({
    taskType: TASK_TYPE.LEAD_FOLLOW_UP,
    status: { $in: ACTIVE_TASK_STATUSES },
  }).select('+activeLeadFollowUpKey').lean()
  const linkedLeadIds = [...new Set(activeTasks.map((task) => String(task.linkedLead || '')).filter(Boolean))]
  const linkedLeads: any[] = linkedLeadIds.length
    ? await Lead.find({ _id: { $in: linkedLeadIds } }).select('_id organizationId followUpDate isConverted').lean()
    : []
  const leadById = new Map(linkedLeads.map((lead) => [String(lead._id), lead]))

  for (const task of activeTasks) {
    const lead = leadById.get(String(task.linkedLead || ''))
    const stale = !lead
      || String(lead.organizationId) !== String(task.organizationId)
      || lead.isConverted === true
      || !lead.followUpDate
    if (!stale) continue

    await Task.updateOne(
      { _id: task._id },
      { $set: { status: 'Cancelled' }, $unset: { activeLeadFollowUpKey: 1 } },
    )
    await OperationsQueueService.cancel(String(task.organizationId), 'task_reminder', String(task._id))
    cancelled += 1
  }

  console.log(
    `CRM Phase 6 follow-up reconciliation completed: ${candidateLeads.length} canonical Lead follow-ups checked, ${created} generated tasks created, ${updated} generated tasks synchronized, ${cancelled} stale generated tasks cancelled, ${remindersScheduled} future reminders scheduled. No Lead pipeline status was changed.`,
  )

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
