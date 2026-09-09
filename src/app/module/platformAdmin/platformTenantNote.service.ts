import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { writeAudit } from '../audit/audit.service'
import { Organization } from '../organization/organization.model'
import {
  IPlatformTenantNoteAuthor,
  TenantNoteCategory,
} from './platformTenantNote.interface'
import { PlatformTenantNote } from './platformTenantNote.model'

export interface SuperAdminNoteActor {
  id: string
  name: string
  email: string
  userRole?: string
  requestId?: string
  ip?: string
}

export interface CreateTenantNoteInput {
  content: string
  category?: TenantNoteCategory
  pinned?: boolean
}

export interface UpdateTenantNoteInput {
  content?: string
  category?: TenantNoteCategory
  pinned?: boolean
}

const getTenantNotes = async (organizationId: string) => {
  const normalizedOrgId = String(organizationId || '').trim()
  if (!normalizedOrgId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID is required')
  }

  const notes = await PlatformTenantNote.find({ organizationId: normalizedOrgId })
    .sort({ pinned: -1, createdAt: -1 })
    .lean()

  return notes
}

const createTenantNote = async (
  organizationId: string,
  payload: CreateTenantNoteInput,
  actor: SuperAdminNoteActor,
) => {
  const normalizedOrgId = String(organizationId || '').trim()
  if (!normalizedOrgId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID is required')
  }

  const organization = await Organization.findOne({ organizationId: normalizedOrgId }).select('_id organizationId agencyName').lean()
  if (!organization) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }

  const content = String(payload.content || '').trim()
  if (content.length < 2) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Note content must be at least 2 characters')
  }
  if (content.length > 5000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Note content cannot exceed 5000 characters')
  }

  const author: IPlatformTenantNoteAuthor = {
    adminId: actor.id,
    name: actor.name || 'Super Admin',
    email: actor.email || 'admin@platform.internal',
    userRole: actor.userRole || 'super-admin',
  }

  const note = await PlatformTenantNote.create({
    organizationId: normalizedOrgId,
    content,
    category: payload.category || 'general',
    pinned: Boolean(payload.pinned),
    author,
    isEdited: false,
    lastEditedBy: null,
  })

  await writeAudit({
    organizationId: normalizedOrgId,
    actorId: actor.id,
    actorRole: actor.userRole || 'super-admin',
    action: 'platform.tenant.note.created',
    entityType: 'tenant_note',
    entityId: note._id.toString(),
    reason: `Super Admin created internal agency note [${note.category}]`,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      category: note.category,
      pinned: note.pinned,
      snippet: content.slice(0, 120),
    },
  })

  return note
}

const updateTenantNote = async (
  organizationId: string,
  noteId: string,
  payload: UpdateTenantNoteInput,
  actor: SuperAdminNoteActor,
) => {
  const normalizedOrgId = String(organizationId || '').trim()
  const normalizedNoteId = String(noteId || '').trim()
  if (!normalizedOrgId || !normalizedNoteId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID and Note ID are required')
  }

  const note = await PlatformTenantNote.findOne({
    _id: normalizedNoteId,
    organizationId: normalizedOrgId,
  })
  if (!note) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Agency note not found')
  }

  let hasContentOrCategoryChange = false

  if (payload.content !== undefined) {
    const trimmed = String(payload.content).trim()
    if (trimmed.length < 2) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Note content must be at least 2 characters')
    }
    if (trimmed.length > 5000) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Note content cannot exceed 5000 characters')
    }
    if (trimmed !== note.content) {
      note.content = trimmed
      hasContentOrCategoryChange = true
    }
  }

  if (payload.category !== undefined && payload.category !== note.category) {
    note.category = payload.category
    hasContentOrCategoryChange = true
  }

  if (payload.pinned !== undefined && payload.pinned !== note.pinned) {
    note.pinned = Boolean(payload.pinned)
  }

  if (hasContentOrCategoryChange) {
    note.isEdited = true
    note.lastEditedBy = {
      adminId: actor.id,
      name: actor.name || 'Super Admin',
      email: actor.email || 'admin@platform.internal',
      at: new Date(),
    }
  }

  await note.save()

  await writeAudit({
    organizationId: normalizedOrgId,
    actorId: actor.id,
    actorRole: actor.userRole || 'super-admin',
    action: 'platform.tenant.note.updated',
    entityType: 'tenant_note',
    entityId: note._id.toString(),
    reason: `Super Admin updated internal agency note [${note.category}]`,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      category: note.category,
      pinned: note.pinned,
      isEdited: note.isEdited,
    },
  })

  return note
}

const deleteTenantNote = async (
  organizationId: string,
  noteId: string,
  actor: SuperAdminNoteActor,
) => {
  const normalizedOrgId = String(organizationId || '').trim()
  const normalizedNoteId = String(noteId || '').trim()
  if (!normalizedOrgId || !normalizedNoteId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID and Note ID are required')
  }

  const note = await PlatformTenantNote.findOneAndDelete({
    _id: normalizedNoteId,
    organizationId: normalizedOrgId,
  })
  if (!note) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Agency note not found')
  }

  await writeAudit({
    organizationId: normalizedOrgId,
    actorId: actor.id,
    actorRole: actor.userRole || 'super-admin',
    action: 'platform.tenant.note.deleted',
    entityType: 'tenant_note',
    entityId: note._id.toString(),
    reason: `Super Admin deleted internal agency note [${note.category}]`,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      category: note.category,
      pinned: note.pinned,
      snippet: note.content.slice(0, 120),
    },
  })

  return { success: true, message: 'Agency note deleted successfully' }
}

export const PlatformTenantNoteService = {
  getTenantNotes,
  createTenantNote,
  updateTenantNote,
  deleteTenantNote,
}
