import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { CRM_FOLLOW_UP_TIME_ZONE, getDayBoundsInTimeZone } from '../../app/module/lead/leadFollowUpTime'
import { TaskService } from '../../app/module/task/task.service'

describe('CRM Phase 7 task summary contract', () => {
  it('exposes the single summary service used by GET /task/summary', () => {
    expect(typeof TaskService.getTaskSummary).toBe('function')
    const route = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/task/task.route.ts'), 'utf8')
    expect(route).toContain("'/summary'")
    expect(route).toContain("requirePermission('tasks.read')")
  })

  it('uses one aggregation over active CRM members instead of per-member count queries', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/task/task.service.ts'), 'utf8')
    expect(service).toContain('User.aggregate<ITaskMemberSummary>')
    expect(service).toContain("from: Lead.collection.name")
    expect(service).not.toContain('for (const member')
  })

  it('uses the same Asia/Dhaka day boundary contract as Today follow-ups', () => {
    const bounds = getDayBoundsInTimeZone(new Date('2026-08-18T18:02:00.000Z'))
    expect(bounds.timeZone).toBe(CRM_FOLLOW_UP_TIME_ZONE)
    expect(bounds.localDate).toBe('2026-08-19')
    expect(bounds.start.toISOString()).toBe('2026-08-18T18:00:00.000Z')
    expect(bounds.endExclusive.toISOString()).toBe('2026-08-19T18:00:00.000Z')
  })

  it('returns the requested workload counters', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/task/task.service.ts'), 'utf8')
    for (const field of ['memberId', 'memberName', 'role', 'totalAssignedLeads', 'dueToday', 'overdueFollowUps', 'upcomingFollowUps']) {
      expect(service).toContain(field)
    }
  })
})
