import { describe, expect, it } from 'vitest'
import { LeadLifecycleService } from '../../app/module/lead/leadLifecycle.service'
import { CRM_FOLLOW_UP_TIME_ZONE, getDayBoundsInTimeZone } from '../../app/module/lead/leadFollowUpTime'
import { LeadValidation } from '../../app/module/lead/lead.validation'
import { TaskService } from '../../app/module/task/task.service'
import fs from 'fs'
import path from 'path'


describe('CRM Phase 6 follow-up engine contract', () => {
  it('uses Asia/Dhaka business-day boundaries instead of UTC calendar dates', () => {
    const reference = new Date('2026-08-18T17:36:00.000Z') // 23:36 on Aug 18 in Dhaka
    const bounds = getDayBoundsInTimeZone(reference)
    expect(bounds.timeZone).toBe(CRM_FOLLOW_UP_TIME_ZONE)
    expect(bounds.localDate).toBe('2026-08-18')
    expect(bounds.start.toISOString()).toBe('2026-08-17T18:00:00.000Z')
    expect(bounds.endExclusive.toISOString()).toBe('2026-08-18T18:00:00.000Z')
  })

  it('requires a date when a new Lead is explicitly created in Follow-up Scheduled', () => {
    const missingDate = LeadValidation.createLeadZodSchema.safeParse({
      body: { name: 'Rahim Ahmed', phone: '01700000000', leadStatus: 'FollowUpScheduled' },
    })
    expect(missingDate.success).toBe(false)

    const withDate = LeadValidation.createLeadZodSchema.safeParse({
      body: {
        name: 'Rahim Ahmed',
        phone: '01700000000',
        leadStatus: 'FollowUpScheduled',
        followUpDate: '2026-08-19T04:30:00.000Z',
      },
    })
    expect(withDate.success).toBe(true)
  })

  it('keeps scheduling and generated Task synchronization behind lifecycle-owned services', () => {
    expect(typeof LeadLifecycleService.scheduleFollowUp).toBe('function')
    expect(typeof TaskService.syncLeadFollowUpTask).toBe('function')
  })

  it('ships an idempotent existing-data reconciliation migration', () => {
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'src/app/db/migrateCrmFollowUpEngine.ts'), 'utf8')
    expect(migration).toContain('Lead.followUpDate is canonical')
    expect(migration).toContain('activeLeadFollowUpKey')
    expect(migration).toContain('OperationsQueueService.schedule')
  })
})
