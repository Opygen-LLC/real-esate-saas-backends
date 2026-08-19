import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActivityValidation } from '../../app/module/activity/activity.validation'
import { ContactValidation } from '../../app/module/contact/contact.validation'
import { LeadValidation } from '../../app/module/lead/lead.validation'
import {
  DEFAULT_LEAD_PIPELINE_STAGES,
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_VALUES,
} from '../../app/module/lead/leadStatus.contract'
import { getDayBoundsInTimeZone } from '../../app/module/lead/leadFollowUpTime'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('CRM Phase 14 automated regression contract', () => {
  it('locks the complete fourteen-stage real-estate lifecycle and labels', () => {
    expect(LEAD_STATUS_VALUES).toEqual([
      'New',
      'Contacted',
      'FollowUpScheduled',
      'NoResponse',
      'Interested',
      'ViewingScheduled',
      'ViewingCompleted',
      'Negotiation',
      'OfferMade',
      'Won',
      'Lost',
      'OnHold',
      'NotQualified',
      'ReEngaged',
    ])
    expect(DEFAULT_LEAD_PIPELINE_STAGES).toHaveLength(14)
    expect(LEAD_STATUS_LABELS[LEAD_STATUS.WON]).toBe('Won / Converted')
    expect(LEAD_STATUS_LABELS[LEAD_STATUS.VIEWING_COMPLETED]).toBe('Viewing Done')
  })

  it('rejects client-owned audit, assignment, lifecycle and conversion fields', () => {
    const createProtected: Record<string, unknown> = {
      createdBy: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439011',
      convertedAt: '2026-08-19T00:00:00.000Z',
      convertedBy: '507f1f77bcf86cd799439011',
      convertedContactId: '507f1f77bcf86cd799439012',
      isConverted: true,
      contactId: '507f1f77bcf86cd799439012',
    }
    for (const [field, value] of Object.entries(createProtected)) {
      const result = LeadValidation.createLeadZodSchema.safeParse({ body: { name: 'Client', phone: '01700000000', [field]: value } })
      expect(result.success, `createLead accepted ${field}`).toBe(false)
    }

    const patchProtected: Record<string, unknown> = {
      leadStatus: LEAD_STATUS.INTERESTED,
      assignedAgent: '507f1f77bcf86cd799439011',
      createdBy: '507f1f77bcf86cd799439011',
      updatedBy: '507f1f77bcf86cd799439011',
      convertedAt: '2026-08-19T00:00:00.000Z',
      convertedBy: '507f1f77bcf86cd799439011',
      convertedContactId: '507f1f77bcf86cd799439012',
      isConverted: true,
      contactId: '507f1f77bcf86cd799439012',
      followUpDate: '2026-08-19T10:00:00.000Z',
      nextFollowUp: '2026-08-19T10:00:00.000Z',
      notes: 'overwrite history',
    }
    for (const [field, value] of Object.entries(patchProtected)) {
      const result = LeadValidation.updateLeadZodSchema.safeParse({ body: { [field]: value } })
      expect(result.success, `generic Lead PATCH accepted ${field}`).toBe(false)
    }
  })

  it('keeps note authorship server-owned and notes append-only', () => {
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: { content: 'Followed up with the client.' } }).success).toBe(true)
    expect(ActivityValidation.appendNoteZodSchema.safeParse({ body: {
      content: 'Forged author',
      authorId: '507f1f77bcf86cd799439011',
    } }).success).toBe(false)

    const leadRoute = read('src/app/module/lead/lead.route.ts')
    const contactRoute = read('src/app/module/contact/contact.route.ts')
    expect(leadRoute).toMatch(/post\('\/:id\/notes'/)
    expect(contactRoute).toMatch(/post\(\s*'\/:id\/notes'/)
    expect(leadRoute).not.toMatch(/patch\([^)]*\/:id\/notes|delete\([^)]*\/:id\/notes/i)
    expect(contactRoute).not.toMatch(/patch\([^)]*\/:id\/notes|delete\([^)]*\/:id\/notes/i)
  })

  it('keeps Contact conversion/audit metadata server-owned', () => {
    for (const field of ['sourceLeadId', 'convertedAt', 'convertedBy', 'createdBy', 'updatedBy', 'statusAtConversion', 'relationshipState']) {
      const result = ContactValidation.createContactZodSchema.safeParse({ body: {
        name: 'Client',
        phone: '01700000000',
        [field]: field === 'convertedAt' ? '2026-08-19T00:00:00.000Z' : '507f1f77bcf86cd799439011',
      } })
      expect(result.success, `Contact create accepted ${field}`).toBe(false)
    }
  })

  it('requires Follow-up Scheduled to have a canonical follow-up date but does not couple scheduling to a stage change', () => {
    expect(LeadValidation.createLeadZodSchema.safeParse({ body: {
      name: 'Client', phone: '01700000000', leadStatus: LEAD_STATUS.FOLLOW_UP_SCHEDULED,
    } }).success).toBe(false)
    expect(LeadValidation.createLeadZodSchema.safeParse({ body: {
      name: 'Client', phone: '01700000000', leadStatus: LEAD_STATUS.FOLLOW_UP_SCHEDULED,
      followUpDate: '2026-08-19T04:00:00.000Z',
    } }).success).toBe(true)

    const lifecycle = read('src/app/module/lead/leadLifecycle.service.ts')
    const schedulerSlice = lifecycle.slice(lifecycle.indexOf('const scheduleFollowUp'), lifecycle.indexOf('const recordContact'))
    expect(schedulerSlice).toContain('lead.followUpDate = dueAt')
    expect(schedulerSlice).not.toContain('lead.leadStatus =')
  })

  it('uses exact Asia/Dhaka midnight boundaries for Today follow-ups', () => {
    const bounds = getDayBoundsInTimeZone(new Date('2026-08-18T18:00:01.000Z'))
    expect(bounds.localDate).toBe('2026-08-19')
    expect(bounds.start.toISOString()).toBe('2026-08-18T18:00:00.000Z')
    expect(bounds.endExclusive.toISOString()).toBe('2026-08-19T18:00:00.000Z')
  })

  it('keeps secure preview/confirm import and filtered export routes in the public API contract', () => {
    const importService = read('src/app/module/lead/leadImport.service.ts')
    const importUpload = read('src/app/module/import/spreadsheetImport.middleware.ts')
    const leadRoute = read('src/app/module/lead/lead.route.ts')
    const contactRoute = read('src/app/module/contact/contact.route.ts')

    expect(leadRoute).toContain("'/import/preview'")
    expect(leadRoute).toContain("'/import/confirm'")
    expect(leadRoute).toContain("'/import/template.csv'")
    expect(leadRoute).toContain("'/import/template.xlsx'")
    expect(importService).toContain('IMPORT_SESSION_TTL_SECONDS = 30 * 60')
    expect(importService).toContain("LeadImportSession.findOneAndDelete")
    expect(importService).not.toContain('assertRedisSessionsAvailable')
    expect(importService).toContain("duplicatePolicy: 'reject'")
    expect(importService).toContain("Duplicate phone appears earlier in this import file")
    expect(importService).toContain("Duplicate phone matches an existing Lead")
    expect(importUpload).toContain("application/octet-stream")
    expect(importUpload).toContain("x-import-file-name")
    expect(importUpload).toContain("contentType === 'multipart/form-data'")
    expect(importUpload).not.toContain('allowedMimeByExtension')

    for (const route of [leadRoute, contactRoute]) {
      expect(route).toContain("'/export/csv'")
      expect(route).toContain("'/export/xlsx'")
      expect(route).toContain("requirePermission('crm.export')")
    }
  })
})
