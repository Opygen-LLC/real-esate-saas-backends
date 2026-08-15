import { describe, expect, it } from 'vitest'
import { normalizeCustomPermissions, permissionValues, permissionsForRole, roleHasPermission } from '../../app/module/user/accessControl'
import { PlatformSettingsValidation } from '../../app/module/platformSettings/platformSettings.validation'

describe('phase 3 agency publishing and support contacts', () => {
  it('keeps listing publication owner-controlled and removes stale compliance permissions', () => {
    expect(roleHasPermission('agency_owner', 'properties.publish')).toBe(true)
    expect(roleHasPermission('agency_admin', 'properties.publish')).toBe(true)
    expect(roleHasPermission('agent', 'properties.publish')).toBe(false)
    expect(permissionValues).not.toContain('compliance.read')
    expect(permissionValues).not.toContain('compliance.write')
    expect(normalizeCustomPermissions(['properties.publish'])).toEqual(expect.arrayContaining([
      'properties.read', 'properties.write', 'properties.publish',
    ]))
    expect(permissionsForRole('agent')).not.toContain('properties.publish')
  })

  it('accepts canonical Bangladesh support contacts and rejects invalid local phone formats', () => {
    const body = {
      reason: 'Update official support contact channels',
      support: {
        whatsapp: '+8801891793354',
        phone: '+8801891793354',
        email: 'support@example.com',
        facebook: 'https://facebook.com/example',
        messenger: '',
        instagram: '',
        linkedin: '',
        youtube: '',
        website: 'https://example.com',
      },
    }
    expect(PlatformSettingsValidation.update.safeParse({ body }).success).toBe(true)
    expect(PlatformSettingsValidation.update.safeParse({ body: { ...body, support: { ...body.support, whatsapp: '01891793354' } } }).success).toBe(false)
  })
})
