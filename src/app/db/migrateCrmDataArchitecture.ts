import mongoose from 'mongoose'
import config from '../../config'
import { normalizeBangladeshPhone, normalizeEmail } from '../helpers/identity'
import { ACTIVE_TASK_STATUSES, TASK_TYPE, TASK_TYPE_VALUES } from '../module/task/taskType.contract'

const sameKey = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  JSON.stringify(left) === JSON.stringify(right)

const ensureIndex = async (
  collection: any,
  key: Record<string, 1 | -1>,
  options: Record<string, unknown>,
) => {
  const existing = await collection.indexes()
  const equivalent = existing.find((index: any) => sameKey(index.key, key))
  if (equivalent) {
    const requiresUnique = options.unique === true
    const requiresSparse = options.sparse === true
    const requiredPartial = options.partialFilterExpression
    if (requiresUnique && equivalent.unique !== true) {
      throw new Error(`Index ${equivalent.name} has the required key pattern but is not unique`)
    }
    if (requiresSparse && equivalent.sparse !== true) {
      throw new Error(`Index ${equivalent.name} has the required key pattern but is not sparse`)
    }
    if (requiredPartial && JSON.stringify(equivalent.partialFilterExpression || null) !== JSON.stringify(requiredPartial)) {
      throw new Error(`Index ${equivalent.name} has the required key pattern but an incompatible partial filter`)
    }
    return equivalent.name
  }
  return collection.createIndex(key, options)
}

const taskDueAt = (dueDate: unknown, dueTime: unknown): Date => {
  const date = String(dueDate || '')
  const time = String(dueTime || '09:00')
  const parsed = new Date(`${date}T${time}:00+06:00`)
  if (!date || Number.isNaN(parsed.getTime())) throw new Error(`Invalid task due date/time: ${date} ${time}`)
  return parsed
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const leads = db.collection('leads')
  const contacts = db.collection('contacts')
  const tasks = db.collection('tasks')

  const leadBackfill = await leads.updateMany(
    {},
    [
      {
        $set: {
          followUpDate: { $ifNull: ['$followUpDate', '$nextFollowUp'] },
          isConverted: { $ifNull: ['$isConverted', false] },
          firstContactedAt: { $ifNull: ['$firstContactedAt', '$firstResponseAt'] },
        },
      },
    ],
  )

  let contactsNormalized = 0
  let contactsWithInvalidPhone = 0
  for await (const contact of contacts.find({}, { projection: { phone: 1, email: 1, normalizedPhone: 1, normalizedEmail: 1 } })) {
    const patch: Record<string, unknown> = {}
    if (contact.phone) {
      try {
        const normalizedPhone = normalizeBangladeshPhone(String(contact.phone))
        if (contact.normalizedPhone !== normalizedPhone) patch.normalizedPhone = normalizedPhone
      } catch {
        contactsWithInvalidPhone += 1
      }
    }
    if (contact.email) {
      try {
        const normalizedEmail = normalizeEmail(String(contact.email))
        if (contact.normalizedEmail !== normalizedEmail) patch.normalizedEmail = normalizedEmail
      } catch {
        // Existing malformed optional emails remain untouched; validation blocks new malformed values.
      }
    } else if (contact.normalizedEmail !== '') {
      patch.normalizedEmail = ''
    }
    if (Object.keys(patch).length) {
      await contacts.updateOne({ _id: contact._id }, { $set: patch })
      contactsNormalized += 1
    }
  }

  await tasks.updateMany({ activeLeadFollowUpKey: null }, { $unset: { activeLeadFollowUpKey: '' } })

  const invalidTasks: string[] = []
  let tasksBackfilled = 0
  const activeFollowUpKeys = new Map<string, string>()
  for await (const task of tasks.find({}, { projection: { organizationId: 1, dueAt: 1, dueDate: 1, dueTime: 1, taskType: 1, linkedLead: 1, assignedAgent: 1, status: 1, activeLeadFollowUpKey: 1 } })) {
    const patch: Record<string, unknown> = {}
    const taskType = task.taskType || TASK_TYPE.GENERAL
    if (task.taskType && !TASK_TYPE_VALUES.includes(task.taskType as any)) {
      throw new Error(`Unsupported taskType on task ${String(task._id)}: ${String(task.taskType)}`)
    }
    if (!task.taskType) patch.taskType = TASK_TYPE.GENERAL

    const currentDueAt = task.dueAt instanceof Date ? task.dueAt : task.dueAt ? new Date(task.dueAt) : undefined
    if (!currentDueAt || Number.isNaN(currentDueAt.getTime())) {
      try {
        patch.dueAt = taskDueAt(task.dueDate, task.dueTime)
      } catch {
        invalidTasks.push(String(task._id))
      }
    } else if (!(task.dueAt instanceof Date)) {
      patch.dueAt = currentDueAt
    }

    if (taskType === TASK_TYPE.LEAD_FOLLOW_UP && ACTIVE_TASK_STATUSES.includes(task.status as any)) {
      if (!task.organizationId || !task.linkedLead || !task.assignedAgent) {
        invalidTasks.push(String(task._id))
      } else {
        const key = `${String(task.organizationId)}:${String(task.linkedLead)}`
        const duplicateTaskId = activeFollowUpKeys.get(key)
        if (duplicateTaskId && duplicateTaskId !== String(task._id)) {
          throw new Error(`Duplicate active lead follow-up tasks detected for ${key}: ${duplicateTaskId}, ${String(task._id)}. Resolve the duplicate before retrying the migration.`)
        }
        activeFollowUpKeys.set(key, String(task._id))
        if (task.activeLeadFollowUpKey !== key) patch.activeLeadFollowUpKey = key
      }
    } else if (task.activeLeadFollowUpKey) {
      patch.activeLeadFollowUpKey = null
    }

    if (Object.keys(patch).length) {
      const $set = { ...patch }
      const unsetActive = $set.activeLeadFollowUpKey === null
      if (unsetActive) delete $set.activeLeadFollowUpKey
      await tasks.updateOne(
        { _id: task._id },
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(unsetActive ? { $unset: { activeLeadFollowUpKey: '' } } : {}),
        },
      )
      tasksBackfilled += 1
    }
  }

  if (invalidTasks.length) {
    throw new Error(`CRM Phase 1 migration stopped: ${invalidTasks.length} task(s) have invalid/missing deadline or lead-follow-up relations. Example task ids: ${invalidTasks.slice(0, 20).join(', ')}`)
  }

  await ensureIndex(leads, { organizationId: 1, isConverted: 1, leadStatus: 1 }, { name: 'lead_tenant_converted_status' })
  await ensureIndex(leads, { organizationId: 1, assignedAgent: 1, isConverted: 1 }, { name: 'lead_tenant_assignee_converted' })
  await ensureIndex(leads, { organizationId: 1, followUpDate: 1, assignedAgent: 1 }, { name: 'lead_tenant_followup_assignee' })
  await ensureIndex(leads, { organizationId: 1, source: 1 }, { name: 'lead_tenant_source' })
  await ensureIndex(leads, { organizationId: 1, createdAt: -1 }, { name: 'lead_tenant_created' })

  await ensureIndex(contacts, { organizationId: 1, normalizedPhone: 1 }, { name: 'contact_tenant_normalized_phone' })
  await ensureIndex(contacts, { organizationId: 1, normalizedEmail: 1 }, { name: 'contact_tenant_normalized_email' })
  await ensureIndex(contacts, { organizationId: 1, assignedTo: 1, updatedAt: -1 }, { name: 'contact_tenant_assignee_updated' })
  await ensureIndex(contacts, { organizationId: 1, followUpDate: 1, assignedTo: 1 }, { name: 'contact_tenant_followup_assignee' })
  await ensureIndex(contacts, { organizationId: 1, source: 1 }, { name: 'contact_tenant_source' })
  await ensureIndex(
    contacts,
    { organizationId: 1, sourceLeadId: 1 },
    { name: 'contact_tenant_source_lead_unique', unique: true, partialFilterExpression: { sourceLeadId: { $type: 'objectId' } } },
  )

  await ensureIndex(tasks, { organizationId: 1, dueAt: 1, status: 1 }, { name: 'task_tenant_dueat_status' })
  await ensureIndex(tasks, { organizationId: 1, taskType: 1, assignedAgent: 1, dueAt: 1 }, { name: 'task_tenant_type_assignee_dueat' })
  await ensureIndex(tasks, { organizationId: 1, linkedLead: 1, taskType: 1, status: 1 }, { name: 'task_tenant_lead_type_status' })
  await ensureIndex(tasks, { activeLeadFollowUpKey: 1 }, { name: 'task_active_lead_followup_unique', unique: true, sparse: true })

  console.log(
    `CRM Phase 1 data architecture migration completed: ${leadBackfill.modifiedCount} lead documents backfilled, ${contactsNormalized} contacts normalized, ${contactsWithInvalidPhone} legacy contacts kept without normalized phone, ${tasksBackfilled} tasks backfilled, and canonical indexes verified. Legacy createdBy/updatedBy values were intentionally not invented for historical records.`,
  )

  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
