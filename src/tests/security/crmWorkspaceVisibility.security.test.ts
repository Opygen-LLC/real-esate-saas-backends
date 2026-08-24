import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import {
  crmAccessFromRequest,
  crmAssignmentOwnerFilter,
  crmMutationOwnerFilter,
  crmReadOwnerFilter,
} from '../../app/module/crm/crmAccess'
import { effectivePermissionsForUser, normalizeCustomPermissions } from '../../app/module/user/accessControl'
import { LeadValidation } from '../../app/module/lead/lead.validation'

const requestFor = (input: { userId: string; role: string; permissions: string[] }) => ({
  tenant: {
    userId: input.userId,
    role: input.role,
    permissions: input.permissions,
  },
} as unknown as Request)

describe('CRM workspace visibility and team-management contract', () => {
  it('keeps own-only members mutation scoped while managers default to team records', () => {
    const member = crmAccessFromRequest(requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read', 'leads.write'] }))
    expect(member.scope).toBe('mine')
    expect(crmReadOwnerFilter('assignedAgent', member)).toEqual({ assignedAgent: 'agent-1' })
    expect(crmMutationOwnerFilter('assignedAgent', member)).toEqual({ assignedAgent: 'agent-1' })

    const admin = crmAccessFromRequest(requestFor({ userId: 'admin-1', role: 'agency_admin', permissions: ['leads.read'] }))
    expect(admin.scope).toBe('team')
    expect(crmReadOwnerFilter('assignedAgent', admin)).toEqual({})
    expect(crmMutationOwnerFilter('assignedAgent', admin)).toEqual({})
  })

  it('allows crm.team.read to view team records without granting generic team mutation', () => {
    expect(() => crmAccessFromRequest(
      requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read'] }),
      'team',
    )).toThrow(/crm\.team\.read/i)

    const teamReader = crmAccessFromRequest(
      requestFor({ userId: 'agent-1', role: 'agent', permissions: ['leads.read', 'leads.write', 'crm.team.read'] }),
      'team',
    )
    expect(teamReader.scope).toBe('team')
    expect(crmReadOwnerFilter('assignedAgent', teamReader)).toEqual({})
    expect(crmMutationOwnerFilter('assignedAgent', teamReader)).toEqual({ assignedAgent: 'agent-1' })
  })

  it('grants team-wide CRM mutation only with crm.team.manage', () => {
    const normalized = normalizeCustomPermissions(['crm.team.manage'])
    for (const required of [
      'crm.team.read', 'leads.read', 'leads.write', 'leads.assign',
      'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write',
      'viewings.read', 'viewings.write',
    ]) {
      expect(normalized).toContain(required)
    }

    const teamManager = crmAccessFromRequest(requestFor({
      userId: 'agent-1',
      role: 'agent',
      permissions: normalized,
    }))
    expect(teamManager.scope).toBe('team')
    expect(crmMutationOwnerFilter('assignedAgent', teamManager)).toEqual({})
    expect(crmMutationOwnerFilter('assignedTo', teamManager)).toEqual({})
    expect(crmMutationOwnerFilter('agentId', teamManager)).toEqual({})
  })

  it('allows team-readable members with leads.assign to reassign visible team leads without granting other team writes', () => {
    const assignmentUser = crmAccessFromRequest(requestFor({
      userId: 'agent-1',
      role: 'agent',
      permissions: ['leads.read', 'leads.assign', 'crm.team.read'],
    }), 'team')

    expect(crmAssignmentOwnerFilter('assignedAgent', assignmentUser)).toEqual({})
    expect(crmMutationOwnerFilter('assignedAgent', assignmentUser)).toEqual({ assignedAgent: 'agent-1' })
  })

  it('keeps agency-admin CRM authority even when unrelated custom permissions are used', () => {
    const permissions = effectivePermissionsForUser({
      userRole: 'agency_admin',
      accessControl: { useRoleDefaults: false, permissions: ['properties.read'] },
    })
    for (const required of [
      'leads.read', 'leads.write', 'leads.assign', 'crm.team.read', 'crm.team.manage',
      'contacts.read', 'contacts.write', 'tasks.read', 'tasks.write',
      'viewings.read', 'viewings.write', 'crm.export',
    ]) {
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
