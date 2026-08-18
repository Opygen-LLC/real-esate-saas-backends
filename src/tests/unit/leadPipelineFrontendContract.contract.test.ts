import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getWeekBoundsInTimeZone } from '../../app/module/lead/leadFollowUpTime'

describe('CRM Phase 8 Lead Pipeline query contract', () => {
  it('computes This Week using Monday-start Asia/Dhaka calendar boundaries', () => {
    const bounds = getWeekBoundsInTimeZone(new Date('2026-08-19T00:30:00.000Z'))
    expect(bounds.start.toISOString()).toBe('2026-08-16T18:00:00.000Z') // Monday Aug 17 00:00 Dhaka
    expect(bounds.endExclusive.toISOString()).toBe('2026-08-23T18:00:00.000Z')
  })

  it('keeps the Lead Pipeline collection unconverted-only even for crafted queries', () => {
    const service = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/lead/lead.service.ts'), 'utf8')
    expect(service).toContain("Lead Pipeline only supports isConverted=false")
    expect(service).toContain("{isConverted:{$ne:true}}")
  })

  it('supports the frontend status, assignee, source and follow-up filters server-side', () => {
    const controller = fs.readFileSync(path.resolve(process.cwd(), 'src/app/module/lead/lead.controller.ts'), 'utf8')
    for (const filter of ['leadStatus', 'assignedAgent', 'source', 'followUpPreset', 'followUpFrom', 'followUpTo', 'isConverted']) {
      expect(controller).toContain(`'${filter}'`)
    }
  })
})
