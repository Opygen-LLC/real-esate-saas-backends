import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { SupportService } from './support.service'
import { writeAudit } from '../audit/audit.service'

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const ticket = await SupportService.create(requireTenant(req), req.user?._id, req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Support ticket created successfully', data: ticket })
})

const getMyTickets = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Support tickets fetched successfully', data: await SupportService.listTenant(requireTenant(req)) })
})

const getAllTicketsSuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.listAdmin(req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'All platform support tickets fetched successfully', data: result.data, meta: result.meta })
})

const replyToTicket = catchAsync(async (req: Request, res: Response) => {
  const role = req.user?.userRole || ''
  const data = await SupportService.reply(req.params.id, req.body.message, { id: req.user!._id!, role, organizationId: role === 'super-admin' ? undefined : requireTenant(req) })
  if (role === 'super-admin') await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'support.reply', entityType: 'supportTicket', entityId: req.params.id, requestId: req.requestId, ip: req.ip })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Reply sent successfully', data })
})

const updateTicketStatus = catchAsync(async (req: Request, res: Response) => {
  const role = req.user?.userRole || ''
  const data = await SupportService.update(req.params.id, req.body, { id: req.user!._id!, role, organizationId: role === 'super-admin' ? undefined : requireTenant(req) })
  if (role === 'super-admin') await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'support.ticket_updated', entityType: 'supportTicket', entityId: req.params.id, requestId: req.requestId, ip: req.ip, metadata: { status: req.body.status, priority: req.body.priority } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Ticket updated successfully', data })
})

const assignOwner = catchAsync(async (req: Request, res: Response) => {
  const data = await SupportService.assignOwner(req.params.id, req.body.ownerId || null)
  await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'support.owner_assigned', entityType: 'supportTicket', entityId: req.params.id, requestId: req.requestId, ip: req.ip, metadata: { ownerId: req.body.ownerId || null } })
  sendResponse(res, { statusCode: 200, success: true, message: 'Support owner updated', data })
})

const addInternalNote = catchAsync(async (req: Request, res: Response) => {
  const data = await SupportService.addInternalNote(req.params.id, req.user!._id!, req.body.note)
  await writeAudit({ organizationId: data.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'support.internal_note_added', entityType: 'supportTicket', entityId: req.params.id, requestId: req.requestId, ip: req.ip })
  sendResponse(res, { statusCode: 200, success: true, message: 'Internal note added', data })
})

const createAttachmentUpload = catchAsync(async (req: Request, res: Response) => {
  const role = req.user?.userRole || ''
  const data = await SupportService.createAttachmentUpload(req.params.id, req.body, { id: req.user!._id!, role, organizationId: role === 'super-admin' ? undefined : requireTenant(req) })
  sendResponse(res, { statusCode: 201, success: true, message: 'Attachment upload created', data })
})


const getAttachmentDownload = catchAsync(async (req: Request, res: Response) => {
  const role = req.user?.userRole || ''
  const data = await SupportService.getAttachmentDownload(req.params.id, req.params.attachmentId, { role, organizationId: role === 'super-admin' ? undefined : requireTenant(req) })
  sendResponse(res, { statusCode: 200, success: true, message: 'Attachment download created', data })
})

const completeAttachmentUpload = catchAsync(async (req: Request, res: Response) => {
  const role = req.user?.userRole || ''
  const data = await SupportService.completeAttachmentUpload(req.params.id, req.params.attachmentId, { id: req.user!._id!, role, organizationId: role === 'super-admin' ? undefined : requireTenant(req) })
  sendResponse(res, { statusCode: 200, success: true, message: 'Attachment upload completed', data })
})

export const SupportController = { createTicket, getMyTickets, getAllTicketsSuperAdmin, replyToTicket, updateTicketStatus, assignOwner, addInternalNote, createAttachmentUpload, completeAttachmentUpload, getAttachmentDownload }
