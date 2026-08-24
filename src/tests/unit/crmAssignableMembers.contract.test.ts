import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { memberCanReceiveCapability } from '../../app/module/crm/crmAssignableMember.service'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('capability-based CRM assignment contract', () => {
  it('allows any active-role shape to receive a Lead when effective permissions include lead read/write', () => {
    expect(memberCanReceiveCapability({ userRole: 'agency_owner' }, 'lead')).toBe(true)
    expect(memberCanReceiveCapability({ userRole: 'agency_admin' }, 'lead')).toBe(true)
    expect(memberCanReceiveCapability({ userRole: 'agent' }, 'lead')).toBe(true)

    expect(memberCanReceiveCapability({ userRole: 'staff' }, 'lead')).toBe(false)
    expect(memberCanReceiveCapability({
      userRole: 'staff',
      profile: { accessControl: { useRoleDefaults: false, permissions: ['leads.write'] } },
    }, 'lead')).toBe(true)
    expect(memberCanReceiveCapability({
      userRole: 'viewer',
      profile: { accessControl: { useRoleDefaults: false, permissions: ['leads.read', 'leads.write'] } },
    }, 'lead')).toBe(true)
  })

  it('does not require leads.assign to receive a Lead', () => {
    expect(memberCanReceiveCapability({
      userRole: 'staff',
      profile: { accessControl: { useRoleDefaults: false, permissions: ['leads.read', 'leads.write'] } },
    }, 'lead')).toBe(true)
  })

  it('keeps leads.assign as actor authority rather than assignee eligibility', () => {
    const leadRoute = read('src/app/module/lead/lead.route.ts')
    const leadService = read('src/app/module/lead/lead.service.ts')
    const access = read('src/app/module/crm/crmAccess.ts')

    expect(leadRoute).toContain("requirePermission('leads.assign')")
    expect(leadService).toContain("requires leads.assign")
    expect(access).toContain("access.permissions.includes('leads.assign')")
  })

  it('removes fixed agent-role allowlists from Lead/CRM assignment and routes related resources by capability', () => {
    const files = [
      'src/app/module/crm/crm.service.ts',
      'src/app/module/lead/lead.service.ts',
      'src/app/module/lead/leadLifecycle.service.ts',
      'src/app/module/lead/leadImport.service.ts',
      'src/app/module/viewing/viewing.service.ts',
      'src/app/module/property/propertyImport.service.ts',
    ]
    for (const file of files) {
      expect(read(file)).not.toContain("userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] }")
    }
    expect(read('src/app/module/task/task.service.ts')).toContain("assertAssignableMember(organizationId, String(task.assignedAgent), 'task')")
    expect(read('src/app/module/viewing/viewing.service.ts')).toContain("assertAssignableMember(organizationId,String(payload.agentId||''),'viewing')")
    expect(read('src/app/module/property/property.service.ts')).toContain("assertAssignableMember(organizationId, String(normalizedPayload.agentId), 'property'")
  })
})
