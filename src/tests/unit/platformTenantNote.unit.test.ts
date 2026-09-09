import { describe, expect, it } from 'vitest'
import { PlatformTenantNote } from '../../app/module/platformAdmin/platformTenantNote.model'
import { PlatformAdminController } from '../../app/module/platformAdmin/platformAdmin.controller'
import { PlatformTenantNoteService } from '../../app/module/platformAdmin/platformTenantNote.service'

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
    const allowed = [
      'general',
      'support',
      'billing',
      'compliance',
      'feature_request',
      'operational',
    ]
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

  it('ensures platformAdmin controller and service expose note operations', () => {
    expect(PlatformAdminController.getTenantNotes).toBeDefined()
    expect(PlatformAdminController.createTenantNote).toBeDefined()
    expect(PlatformAdminController.updateTenantNote).toBeDefined()
    expect(PlatformAdminController.deleteTenantNote).toBeDefined()

    expect(PlatformTenantNoteService.getTenantNotes).toBeDefined()
    expect(PlatformTenantNoteService.createTenantNote).toBeDefined()
    expect(PlatformTenantNoteService.updateTenantNote).toBeDefined()
    expect(PlatformTenantNoteService.deleteTenantNote).toBeDefined()
  })
})
