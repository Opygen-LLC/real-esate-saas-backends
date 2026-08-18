import { describe, expect, it } from 'vitest'
import { Contact } from '../../app/module/contact/contact.model'
import { ContactValidation } from '../../app/module/contact/contact.validation'
import { Lead } from '../../app/module/lead/lead.model'
import { LeadValidation } from '../../app/module/lead/lead.validation'
import { Task } from '../../app/module/task/task.model'
import { TaskValidation } from '../../app/module/task/task.validation'
import { TASK_TYPE, TASK_TYPE_VALUES } from '../../app/module/task/taskType.contract'

const indexKeyStrings = (model: { schema: { indexes: () => Array<[Record<string, unknown>, Record<string, unknown>]> } }) =>
  model.schema.indexes().map(([keys]) => JSON.stringify(keys))

describe('CRM Phase 1 data architecture contract', () => {
  it('exposes canonical Lead audit, follow-up, and conversion fields with required compound indexes', () => {
    for (const path of ['createdBy','updatedBy','followUpDate','convertedAt','convertedBy','convertedContactId','isConverted','firstContactedAt']) {
      expect(Lead.schema.path(path), `missing Lead.${path}`).toBeTruthy()
    }
    for (const legacyPath of ['nextFollowUp','contactId','notes']) expect(Lead.schema.path(legacyPath)).toBeTruthy()

    const indexes = indexKeyStrings(Lead as any)
    expect(indexes).toContain(JSON.stringify({ organizationId: 1, isConverted: 1, leadStatus: 1 }))
    expect(indexes).toContain(JSON.stringify({ organizationId: 1, assignedAgent: 1, isConverted: 1 }))
    expect(indexes).toContain(JSON.stringify({ organizationId: 1, followUpDate: 1, assignedAgent: 1 }))
    expect(indexes).toContain(JSON.stringify({ organizationId: 1, source: 1 }))
    expect(indexes).toContain(JSON.stringify({ organizationId: 1, createdAt: -1 }))
  })

  it('keeps Lead audit/conversion fields server-owned while accepting the legacy follow-up alias', () => {
    const valid = LeadValidation.createLeadZodSchema.safeParse({ body: { name: 'Client', phone: '01700000000', nextFollowUp: '2026-08-20T04:00:00.000Z' } })
    expect(valid.success).toBe(true)

    const forged = LeadValidation.createLeadZodSchema.safeParse({ body: { name: 'Client', phone: '01700000000', createdBy: '507f1f77bcf86cd799439011' } })
    expect(forged.success).toBe(false)
  })

  it('upgrades Contact into a relationship record without making conversion metadata client-editable', () => {
    for (const path of ['sourceLeadId','assignedTo','source','propertyInterest','followUpDate','convertedAt','convertedBy','createdBy','updatedBy','normalizedPhone','normalizedEmail','statusAtConversion']) {
      expect(Contact.schema.path(path), `missing Contact.${path}`).toBeTruthy()
    }
    const forged = ContactValidation.createContactZodSchema.safeParse({ body: { name: 'Client', phone: '01700000000', sourceLeadId: '507f1f77bcf86cd799439011' } })
    expect(forged.success).toBe(false)
  })

  it('defines canonical task types, dueAt, and a unique active lead-follow-up guard', () => {
    expect(TASK_TYPE_VALUES).toEqual(['lead_follow_up', 'general', 'viewing_related'])
    expect(Task.schema.path('taskType')).toBeTruthy()
    expect(Task.schema.path('dueAt')).toBeTruthy()
    expect(Task.schema.path('activeLeadFollowUpKey')).toBeTruthy()

    const activeIndex = Task.schema.indexes().find(([keys]) => JSON.stringify(keys) === JSON.stringify({ activeLeadFollowUpKey: 1 }))
    expect(activeIndex?.[1]?.unique).toBe(true)
    expect(activeIndex?.[1]?.sparse).toBe(true)

    const valid = TaskValidation.createTaskZodSchema.safeParse({ body: {
      title: 'Call lead',
      dueAt: '2026-08-20T04:00:00.000Z',
      taskType: TASK_TYPE.LEAD_FOLLOW_UP,
      linkedLead: '507f1f77bcf86cd799439011',
      assignedAgent: '507f191e810c19729de860ea',
    } })
    expect(valid.success).toBe(true)

    const missingOwner = TaskValidation.createTaskZodSchema.safeParse({ body: {
      title: 'Call lead',
      dueAt: '2026-08-20T04:00:00.000Z',
      taskType: TASK_TYPE.LEAD_FOLLOW_UP,
      linkedLead: '507f1f77bcf86cd799439011',
    } })
    expect(missingOwner.success).toBe(false)
  })
})
