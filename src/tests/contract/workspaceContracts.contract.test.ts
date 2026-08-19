import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_RESOURCES,
  buildWebsiteSubmissionReceipt,
  toAuthSessionSummary,
  toTeamMemberLimitContract,
  withWebsiteSubmissionReceipt,
} from '../../contracts/workspaceContracts'
import { wouldExceedEntitlementLimit } from '../../app/module/entitlement/entitlement.service'

describe('Phase 0 workspace contracts', () => {
  it('freezes the canonical workspace resource names', () => {
    expect(WORKSPACE_RESOURCES).toEqual([
      'teamMembers',
      'properties',
      'leads',
      'websiteSubmissions',
      'sessions',
    ])
    expect(WORKSPACE_RESOURCES).not.toContain('agents')
  })

  it('uses one team-member quota regardless of role terminology', () => {
    expect(wouldExceedEntitlementLimit(1, 2)).toBe(false)
    expect(wouldExceedEntitlementLimit(2, 2)).toBe(true)
    expect(wouldExceedEntitlementLimit(4, 2, 0)).toBe(true)
  })

  it('publishes the canonical maxTeamMembers contract while allowing the database to retain maxAgents internally', () => {
    const contract = toTeamMemberLimitContract({ maxAgents: 2, maxProperties: 10 }) as Record<string, unknown>
    expect(contract.maxTeamMembers).toBe(2)
    expect(contract.maxProperties).toBe(10)
    expect(contract).not.toHaveProperty('maxAgents')
  })

  it('adds a stable website-submission receipt without removing the existing public record fields', () => {
    const createdAt = new Date('2026-08-19T06:00:00.000Z')
    const result = withWebsiteSubmissionReceipt('lead', {
      _id: 'lead-1',
      name: 'Public buyer',
      phone: '+8801712345678',
      createdAt,
    })
    expect(result.name).toBe('Public buyer')
    expect(result.submission).toEqual({
      submissionId: 'lead-1',
      submissionType: 'lead',
      status: 'received',
      submittedAt: createdAt.toISOString(),
      linkedEntityId: 'lead-1',
    })
    expect(buildWebsiteSubmissionReceipt('viewing', { _id: 'viewing-1', createdAt }).submissionType).toBe('viewing')
  })

  it('serializes session metadata without authentication secrets', () => {
    const summary = toAuthSessionSummary({
      _id: 'session-1',
      userAgent: 'Browser',
      createdIp: '127.0.0.1',
      lastUsedIp: '127.0.0.2',
      lastUsedAt: new Date('2026-08-19T05:00:00.000Z'),
      expiresAt: new Date('2026-09-18T05:00:00.000Z'),
      createdAt: new Date('2026-08-18T05:00:00.000Z'),
      refreshTokenHash: 'must-never-leak',
      tokenHash: 'must-never-leak',
    }, true) as Record<string, unknown>

    expect(summary.id).toBe('session-1')
    expect(summary.current).toBe(true)
    expect(summary).not.toHaveProperty('refreshTokenHash')
    expect(summary).not.toHaveProperty('tokenHash')
    expect(summary).not.toHaveProperty('familyId')
  })
})
