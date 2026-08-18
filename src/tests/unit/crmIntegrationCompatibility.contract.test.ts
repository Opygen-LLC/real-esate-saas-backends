import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('CRM Phase 12 integration compatibility contract', () => {
  it('uses shared lifecycle status helpers across workload, analytics and entitlements', () => {
    const crm = read('src/app/module/crm/crm.service.ts')
    const dashboard = read('src/app/module/dashboard/dashboard.service.ts')
    const user = read('src/app/module/user/user.service.ts')
    const platform = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')

    expect(crm).toContain('activePipelineLeadFilter()')
    expect(platform).toContain('activePipelineLeadFilter()')
    expect(entitlement).toContain('activePipelineLeadFilter()')
    expect(dashboard).toContain('convertedStatusExpression()')
    expect(user).toContain('convertedStatusExpression()')

    for (const source of [crm, dashboard, user, platform, entitlement]) {
      expect(source).not.toMatch(/leadStatus\s*!==\s*['"]Won['"]/)
      expect(source).not.toMatch(/leadStatus\s*!==\s*['"]Lost['"]/)
    }
  })

  it('keeps viewing-created/completed Lead stage changes behind LeadLifecycleService', () => {
    const viewing = read('src/app/module/viewing/viewing.service.ts')
    expect(viewing).toContain('LeadLifecycleService.changeStatus')
    expect(viewing).toContain('LEAD_STATUS.VIEWING_SCHEDULED')
    expect(viewing).toContain('LEAD_STATUS.VIEWING_COMPLETED')
  })

  it('publishes conversion hints for every CRM read model after the canonical lead.converted event', () => {
    const realtime = read('src/app/module/realtime/realtime.service.ts')
    expect(realtime).toContain("input.eventType === 'lead.converted'")
    expect(realtime).toContain("eventType: 'contact.created_from_lead'")
    expect(realtime).toContain("type: 'task.changed'")
    expect(realtime).toContain("type: 'dashboard.changed'")
    expect(realtime).toContain("type: 'activity.changed'")
  })

  it('keeps first meaningful interactions routed through recordContact', () => {
    const activity = read('src/app/module/activity/activity.service.ts')
    const sms = read('src/app/module/sms/sms.service.ts')
    const whatsapp = read('src/app/module/whatsapp/whatsapp.service.ts')
    expect(activity).toContain('LeadLifecycleService.recordContact')
    expect(sms).toContain('LeadLifecycleService.recordContact')
    expect(whatsapp).toContain('LeadLifecycleService.recordContact')
  })
})
