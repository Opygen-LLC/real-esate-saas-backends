import { describe, expect, it } from 'vitest'
import { effectivePermissionsForUser, normalizeCustomPermissions, roleHasPermission } from '../../app/module/user/accessControl'

describe('agency-owner destructive permissions', () => {
  it('grants destructive finance and website-submission permissions only to agency owners by role', () => {
    expect(roleHasPermission('agency_owner', 'finance.delete')).toBe(true)
    expect(roleHasPermission('agency_owner', 'website.submissions.delete')).toBe(true)
    expect(roleHasPermission('agency_admin', 'finance.delete')).toBe(false)
    expect(roleHasPermission('agency_admin', 'website.submissions.delete')).toBe(false)
  })

  it('strips owner-only destructive permissions from custom member access', () => {
    expect(normalizeCustomPermissions([
      'finance.read',
      'finance.write',
      'finance.delete',
      'website.submissions.read',
      'website.submissions.manage',
      'website.submissions.delete',
      'billing.manage',
    ])).toEqual(expect.arrayContaining(['finance.read', 'finance.write', 'website.submissions.read', 'website.submissions.manage']))

    const permissions = effectivePermissionsForUser({
      userRole: 'agency_admin',
      accessControl: {
        useRoleDefaults: false,
        permissions: ['finance.delete', 'website.submissions.delete'],
      },
    })
    expect(permissions).not.toContain('finance.delete')
    expect(permissions).not.toContain('website.submissions.delete')
    expect(permissions).not.toContain('billing.manage')
  })
})
