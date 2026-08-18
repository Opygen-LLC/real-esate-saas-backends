import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import {
  crmAccessFromRequest,
  crmMutationOwnerFilter,
  crmReadOwnerFilter,
} from '../../app/module/crm/crmAccess'
import { effectivePermissionsForUser } from '../../app/module/user/accessControl'
import { LeadValidation } from '../../app/module/lead/lead.validation'

const requestFor = (input: { userId: string; role: string; permissions: string[] }) => ({
  tenant: {
    userId: input.userId,
    role: input.role,
    permissions: input.permissions,
  },
} as unknown as Request)

describe('CRM Phase 3 workspace visibility contract', () => {
  it('defaults members to their own records and managers to team records', () => {
    const member = crmAccessFromRequest(requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read'] }))
    expect(member.scope).toBe('mine')
    expect(crmReadOwnerFilter('assignedAgent', member)).toEqual({ assignedAgent: 'agent-1' })
    expect(crmMutationOwnerFilter('assignedAgent', member)).toEqual({ assignedAgent: 'agent-1' })

    const admin = crmAccessFromRequest(requestFor({ userId: 'admin-1', role: 'agency_admin', permissions: ['leads.read'] }))
    expect(admin.scope).toBe('team')
    expect(crmReadOwnerFilter('assignedAgent', admin)).toEqual({})
    expect(crmMutationOwnerFilter('assignedAgent', admin)).toEqual({})
  })

  it('requires crm.team.read before a member can request team scope', () => {
    expect(() => crmAccessFromRequest(
      requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read'] }),
      'team',
    )).toThrow(/crm\.team\.read/i)

    const teamReader = crmAccessFromRequest(
      requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read', 'crm.team.read'] }),
      'team',
    )
    expect(teamReader.scope).toBe('team')
    // Team read deliberately does not remove the mutation owner constraint.
    expect(crmMutationOwnerFilter('assignedAgent', teamReader)).toEqual({ assignedAgent: 'agent-1' })
  })

  it('keeps agency-admin CRM authority even when unrelated custom permissions are used', () => {
    const permissions = effectivePermissionsForUser({
      userRole: 'agency_admin',
      accessControl: { useRoleDefaults: false, permissions: ['properties.read'] },
    })
    for (const required of ['leads.read', 'leads.write', 'leads.assign', 'crm.team.read', 'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write', 'crm.export']) {
      expect(permissions).toContain(required)
    }
  })

  it('rejects lifecycle, assignment, audit, and conversion fields on generic lead PATCH validation', () => {
    const protectedFields = [
      'leadStatus', 'assignedAgent', 'createdBy', 'updatedBy', 'convertedAt',
      'convertedBy', 'convertedContactId', 'isConverted', 'contactId', 'lostReason',
      'followUpDate', 'nextFollowUp',
    ]
    for (const field of protectedFields) {
      const result = LeadValidation.updateLeadZodSchema.safeParse({ body: { [field]: field === 'isConverted' ? true : 'forged' } })
      expect(result.success, field).toBe(false)
    }
  })
})
