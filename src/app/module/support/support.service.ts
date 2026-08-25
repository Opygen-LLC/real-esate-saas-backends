import { randomInt, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { sanitizeRichText } from '../../helpers/sanitize'
import { Organization } from '../organization/organization.model'
import { User } from '../user/user.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { scanStoredObject } from '../websiteBuilder/virusScan.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { SupportPriority, SupportStatus, SupportTicket } from './support.model'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'

const SLA_HOURS: Record<SupportPriority, { firstResponse: number; resolution: number }> = {
  urgent: { firstResponse: 1, resolution: 8 },
  high: { firstResponse: 4, resolution: 24 },
  medium: { firstResponse: 8, resolution: 48 },
  low: { firstResponse: 24, resolution: 96 },
}
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
const ALLOWED_ATTACHMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])

const dueAt = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000)
const safeFilename = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'attachment'

const queueCustomerEmail = async (ticket: any, subject: string, body: string) => {
  const [requester, organization] = await Promise.all([
    ticket.userId ? User.findById(ticket.userId).select('email').lean() : null,
    Organization.findOne({ organizationId: ticket.organizationId }).select('email agencyName').lean(),
  ])
  const to = requester?.email || organization?.email
  if (!to) return
  await OperationsQueueService.schedule({
    organizationId: ticket.organizationId,
    type: 'support_email',
    entityId: `${ticket._id.toString()}:${randomUUID()}`,
    runAt: new Date(Date.now() + 1000),
    payload: { to, subject, html: `<p>${sanitizeRichText(body)}</p><p>Ticket: ${ticket.ticketId}</p>` },
  })
  await SupportTicket.updateOne({ _id: ticket._id }, { $set: { lastCustomerNotifiedAt: new Date() } })
}

const create = async (organizationId: string, userId: string | undefined, payload: any) => {
  const priority = (payload.priority || 'medium') as SupportPriority
  const sla = SLA_HOURS[priority]
  const org = await Organization.findOne({ organizationId }).select('agencyName').lean()
  let ticketId = ''
  for (let attempt = 0; attempt < 4; attempt += 1) {
    ticketId = `TCK-${new Date().getUTCFullYear()}-${randomInt(100000, 1000000)}`
    if (!(await SupportTicket.exists({ ticketId }))) break
  }
  const ticket = await SupportTicket.create({
    organizationId,
    organizationName: org?.agencyName || '',
    userId,
    ticketId,
    subject: payload.subject,
    category: payload.category || 'General',
    priority,
    status: 'open',
    description: sanitizeRichText(payload.description),
    firstResponseDueAt: dueAt(sla.firstResponse),
    resolutionDueAt: dueAt(sla.resolution),
  })
  return ticket
}

const presentTicket = (input: any, isSupport: boolean) => {
  const ticket = input?.toObject ? input.toObject({ virtuals: true }) : { ...input }
  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : []
  ticket.attachments = attachments
    .filter((attachment: any) => isSupport || attachment.visibility === 'customer')
    .map((attachment: any) => {
      const plain = attachment?.toObject ? attachment.toObject() : { ...attachment }
      delete plain.key
      delete plain.url
      return plain
    })
  if (!isSupport) ticket.internalNotes = []
  return ticket
}

const listTenant = async (organizationId: string) => {
  const tickets = await SupportTicket.find({ organizationId })
    .populate('ownerId', 'name email').sort({ createdAt: -1 }).lean()
  return tickets.map((ticket) => presentTicket(ticket, false))
}

const listAdmin = async (query: any) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
  const filter: any = {}
  if (query.status) filter.status = query.status
  if (query.priority) filter.priority = query.priority
  if (query.ownerId === 'unassigned') filter.ownerId = null
  else if (query.ownerId && mongoose.isValidObjectId(query.ownerId)) filter.ownerId = query.ownerId
  if (query.sla === 'breached') filter.slaBreachedAt = { $ne: null }
  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = ['ticketId', 'subject', 'organizationName', 'organizationId'].map((field) => ({ [field]: { $regex: escaped, $options: 'i' } }))
  }
  const [data, total] = await Promise.all([
    SupportTicket.find(filter).populate('ownerId', 'name email').sort({ slaBreachedAt: -1, priority: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ])
  return { data: data.map((ticket) => presentTicket(ticket, true)), meta: { page, limit, total } }
}

const findAccessible = async (id: string, organizationId?: string) => {
  const ticket = await SupportTicket.findOne(organizationId ? { _id: id, organizationId } : { _id: id })
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support ticket not found')
  return ticket
}

const reply = async (id: string, message: string, actor: { id: string; role: string; organizationId?: string }) => {
  const isSupport = actor.role === 'super-admin'
  const ticket = await findAccessible(id, isSupport ? undefined : actor.organizationId)
  ticket.messages.push({ sender: isSupport ? 'support' : 'user', authorId: actor.id, message: sanitizeRichText(message), timestamp: new Date() })
  if (isSupport) {
    if (!ticket.firstRespondedAt) ticket.firstRespondedAt = new Date()
    if (ticket.status === 'open') ticket.status = 'in_progress'
  }
  await ticket.save()
  if (isSupport) await queueCustomerEmail(ticket, `Support reply: ${ticket.subject}`, message)
  const populated = await ticket.populate('ownerId', 'name email')
  return presentTicket(populated, isSupport)
}

const update = async (id: string, payload: { status?: SupportStatus; priority?: SupportPriority }, actor: { id: string; role: string; organizationId?: string }) => {
  const isSupport = actor.role === 'super-admin'
  const ticket = await findAccessible(id, isSupport ? undefined : actor.organizationId)
  if (payload.priority && payload.priority !== ticket.priority) {
    if (!isSupport) throw new ApiError(httpStatus.FORBIDDEN, 'Only support staff can change ticket priority')
    ticket.priority = payload.priority
    const sla = SLA_HOURS[payload.priority]
    ticket.firstResponseDueAt = ticket.firstRespondedAt || dueAt(sla.firstResponse)
    ticket.resolutionDueAt = dueAt(sla.resolution)
  }
  if (payload.status) {
    ticket.status = payload.status
    ticket.resolvedAt = ['resolved', 'closed'].includes(payload.status) ? new Date() : null
  }
  await ticket.save()
  if (isSupport && payload.status) await queueCustomerEmail(ticket, `Support ticket ${payload.status.replace('_', ' ')}`, `Your support ticket “${ticket.subject}” is now ${payload.status.replace('_', ' ')}.`)
  const populated = await ticket.populate('ownerId', 'name email')
  return presentTicket(populated, isSupport)
}

const assignOwner = async (id: string, ownerId: string | null) => {
  if (ownerId) {
    const owner = await User.findOne({ _id: ownerId, userRole: 'super-admin', status: 'active' }).select('_id')
    if (!owner) throw new ApiError(httpStatus.BAD_REQUEST, 'Support owner must be an active super administrator')
  }
  const ticket = await SupportTicket.findByIdAndUpdate(id, { $set: { ownerId: ownerId || null, status: ownerId ? 'in_progress' : 'open' } }, { new: true }).populate('ownerId', 'name email')
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support ticket not found')
  return ticket
}

const addInternalNote = async (id: string, authorId: string, note: string) => {
  const ticket = await SupportTicket.findByIdAndUpdate(id, { $push: { internalNotes: { authorId, note: sanitizeRichText(note), timestamp: new Date() } } }, { new: true }).populate('ownerId', 'name email')
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support ticket not found')
  return ticket
}

const createAttachmentUpload = async (id: string, input: { originalName: string; mimeType: string; size: number; visibility: 'customer' | 'internal' }, actor: { id: string; role: string; organizationId?: string }) => {
  const ticket = await findAccessible(id, actor.role === 'super-admin' ? undefined : actor.organizationId)
  await TenantPurgeBarrier.assertTenantWritable(ticket.organizationId)
  if (input.visibility === 'internal' && actor.role !== 'super-admin') throw new ApiError(httpStatus.FORBIDDEN, 'Internal attachments are support-only')
  if (!ALLOWED_ATTACHMENT_TYPES.has(input.mimeType)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported attachment type')
  if (!Number.isFinite(input.size) || input.size < 1 || input.size > MAX_ATTACHMENT_SIZE) throw new ApiError(httpStatus.BAD_REQUEST, 'Attachment must be between 1 byte and 10 MB')
  const attachmentId = new mongoose.Types.ObjectId()
  const key = `support/${ticket.organizationId}/${ticket.ticketId}/${attachmentId.toString()}-${safeFilename(input.originalName)}`
  const signedRef = ObjectStorageService.presignUpload(key)
  const uploadUrl = await signedRef.getUploadUrl()
  ticket.attachments.push({ _id: attachmentId, key, url: '', originalName: input.originalName, mimeType: input.mimeType, declaredSize: input.size, size: 0, visibility: input.visibility, status: 'pending', scanStatus: 'pending', uploadedBy: actor.id, createdAt: new Date() })
  await ticket.save()
  return { attachmentId: attachmentId.toString(), uploadUrl, expiresIn: signedRef.expiresIn, maxSize: MAX_ATTACHMENT_SIZE }
}

const completeAttachmentUpload = async (id: string, attachmentId: string, actor: { id: string; role: string; organizationId?: string }) => {
  const ticket: any = await findAccessible(id, actor.role === 'super-admin' ? undefined : actor.organizationId)
  await TenantPurgeBarrier.assertTenantWritable(ticket.organizationId)
  const attachment = ticket.attachments.id(attachmentId)
  if (!attachment || (attachment.visibility === 'internal' && actor.role !== 'super-admin')) throw new ApiError(httpStatus.NOT_FOUND, 'Support attachment not found')
  if (attachment.status === 'ready') return presentTicket(ticket, actor.role === 'super-admin')
  try {
    const object = await ObjectStorageService.head(attachment.key)
    if (object.size < 1 || object.size > MAX_ATTACHMENT_SIZE || object.size > attachment.declaredSize + 4096) throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded attachment size does not match the declared file')
    const scan = await scanStoredObject(attachment.key)
    attachment.size = object.size
    attachment.scanStatus = scan.status
    attachment.status = 'ready'
    await ticket.save()
    return presentTicket(ticket, actor.role === 'super-admin')
  } catch (error) {
    attachment.status = 'rejected'
    attachment.scanStatus = error instanceof ApiError && error.statusCode === 422 ? 'infected' : attachment.scanStatus
    await ticket.save()
    await ObjectStorageService.remove(attachment.key).catch(() => undefined)
    throw error
  }
}


const getAttachmentDownload = async (id: string, attachmentId: string, actor: { role: string; organizationId?: string }) => {
  const isSupport = actor.role === 'super-admin'
  const ticket: any = await findAccessible(id, isSupport ? undefined : actor.organizationId)
  const attachment = ticket.attachments.id(attachmentId)
  if (!attachment || (!isSupport && attachment.visibility !== 'customer')) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Support attachment not found')
  }
  if (attachment.status !== 'ready' || !['clean', 'skipped'].includes(attachment.scanStatus)) {
    throw new ApiError(httpStatus.CONFLICT, 'Support attachment is not ready for download')
  }
  return { url: ObjectStorageService.presignDownload(attachment.key, 120), expiresIn: 120, name: attachment.originalName, mimeType: attachment.mimeType }
}

const markSlaBreaches = async () => {
  const now = new Date()
  const result = await SupportTicket.updateMany({
    status: { $nin: ['resolved', 'closed'] },
    slaBreachedAt: null,
    $or: [
      { firstRespondedAt: null, firstResponseDueAt: { $lt: now } },
      { resolutionDueAt: { $lt: now } },
    ],
  }, { $set: { slaBreachedAt: now } })
  return { marked: result.modifiedCount }
}

export const SupportService = { create, listTenant, listAdmin, reply, update, assignOwner, addInternalNote, createAttachmentUpload, completeAttachmentUpload, getAttachmentDownload, markSlaBreaches }
