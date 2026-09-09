import { describe, expect, it } from 'vitest'
import { PlatformTenantNote } from '../../app/module/platformAdmin/platformTenantNote.model'
import fs from 'node:fs'
import path from 'node:path'

describe('PlatformTenantNote unit tests', () => {
  it('validates schema requirements for content, organizationId and category', () => {
    const invalidNote = new PlatformTenantNote({
      organizationId: '',
      content: '',
    })

    const error = invalidNote.validateSync()
    expect(error?.errors.organizationId).toBeDefined()
    expect(error?.errors.content).toBeDefined()
  })

  it('sets default category to general and default pinned to false', () => {
    const note = new PlatformTenantNote({
      organizationId: 'org_test_123',
      content: 'Important VIP agency note',
      author: {
        adminId: '507f1f77bcf86cd799439011',
        name: 'Admin User',
        email: 'admin@platform.internal',
        userRole: 'super-admin',
      },
    })

    expect(note.category).toBe('general')
    expect(note.pinned).toBe(false)
    expect(note.isEdited).toBe(false)
    expect(note.lastEditedBy).toBeNull()
  })

  it('supports allowed category values', () => {
    const allowed = ['general', 'support', 'billing', 'compliance', 'feature_request', 'operational']
    for (const cat of allowed) {
      const note = new PlatformTenantNote({
        organizationId: 'org_test_123',
        content: `Note for ${cat}`,
        category: cat as any,
        author: {
          adminId: '507f1f77bcf86cd799439011',
          name: 'Admin User',
          email: 'admin@platform.internal',
          userRole: 'super-admin',
        },
      })
      const error = note.validateSync()
      expect(error).toBeUndefined()
    }
  })

  it('rejects invalid category values', () => {
    const note = new PlatformTenantNote({
      organizationId: 'org_test_123',
      content: 'Note with invalid category',
      category: 'invalid_category' as any,
      author: {
        adminId: '507f1f77bcf86cd799439011',
        name: 'Admin User',
        email: 'admin@platform.internal',
        userRole: 'super-admin',
      },
    })

    const error = note.validateSync()
    expect(error?.errors.category).toBeDefined()
  })

  it('ensures platformAdmin routes and tenant360 include note capabilities', () => {
    const routesContent = fs.readFileSync(path.join(process.cwd(), 'src/app/module/platformAdmin/platformAdmin.route.ts'), 'utf8')
    const controllerContent = fs.readFileSync(path.join(process.cwd(), 'src/app/module/platformAdmin/platformAdmin.controller.ts'), 'utf8')
    const tenant360Content = fs.readFileSync(path.join(process.cwd(), 'src/app/module/platformAdmin/platformAdmin.tenant360.service.ts'), 'utf8')

    expect(routesContent).toContain('/tenants/:organizationId/notes')
    expect(routesContent).toContain('createTenantNote')
    expect(routesContent).toContain('updateTenantNote')
    expect(routesContent).toContain('deleteTenantNote')
    expect(controllerContent).toContain('getTenantNotes')
    expect(controllerContent).toContain('createTenantNote')
    expect(controllerContent).toContain('updateTenantNote')
    expect(controllerContent).toContain('deleteTenantNote')
    expect(tenant360Content).toContain('notes: notes || []')
  })
})
