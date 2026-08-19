import { describe, expect, it } from 'vitest'
import { toAuthSessionSummary } from '../../contracts/workspaceContracts'

describe('phase 8 auth session response contract', () => {
  it('serializes only safe session metadata', () => {
    const summary = toAuthSessionSummary({
      _id: '507f1f77bcf86cd799439011',
      userId: '507f1f77bcf86cd799439012',
      organizationId: 'org-secret',
      familyId: 'family-secret',
      refreshTokenHash: 'refresh-secret',
      tokenHash: 'legacy-secret',
      userAgent: 'Chrome on Windows',
      createdIp: '127.0.0.1',
      lastUsedIp: '127.0.0.2',
      lastUsedAt: new Date('2026-08-19T09:00:00Z'),
      createdAt: new Date('2026-08-18T09:00:00Z'),
      expiresAt: new Date('2026-09-18T09:00:00Z'),
    }, true)

    expect(summary).toEqual({
      id: '507f1f77bcf86cd799439011',
      current: true,
      userAgent: 'Chrome on Windows',
      createdIp: '127.0.0.1',
      lastUsedIp: '127.0.0.2',
      lastUsedAt: '2026-08-19T09:00:00.000Z',
      createdAt: '2026-08-18T09:00:00.000Z',
      expiresAt: '2026-09-18T09:00:00.000Z',
    })
    expect(summary).not.toHaveProperty('refreshTokenHash')
    expect(summary).not.toHaveProperty('tokenHash')
    expect(summary).not.toHaveProperty('familyId')
    expect(summary).not.toHaveProperty('userId')
    expect(summary).not.toHaveProperty('organizationId')
  })
})
