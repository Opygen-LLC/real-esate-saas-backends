import { describe, expect, it } from 'vitest'
import { ActivityService } from '../../app/module/activity/activity.service'
import { ActivityValidation } from '../../app/module/activity/activity.validation'
import { LeadValidation } from '../../app/module/lead/lead.validation'
import { ContactValidation } from '../../app/module/contact/contact.validation'

describe('CRM Phase 5 notes and history contract', () => {
  it('exposes append-only note and unified history services for Leads and Contacts', () => {
    for (const method of ['createLeadNote', 'createContactNote', 'getLeadHistory', 'getContactHistory'] as const) {
      expect(typeof ActivityService[method], method).toBe('function')
    }
  })

  it('requires non-empty note content and rejects caller-supplied note metadata', () => {
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: { content: 'Called client after viewing.' } }).success).toBe(true)
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: { content: '   ' } }).success).toBe(false)
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: { content: 'Valid', authorId: '507f1f77bcf86cd799439011' } }).success).toBe(false)
  })

  it('prevents generic Lead/Contact PATCH from overwriting append-only notes', () => {
    expect(LeadValidation.updateLeadZodSchema.safeParse({ body: { notes: 'replace old note' } }).success).toBe(false)
    expect(ContactValidation.updateContactZodSchema.safeParse({ body: { notes: 'replace old note' } }).success).toBe(false)
  })
})
