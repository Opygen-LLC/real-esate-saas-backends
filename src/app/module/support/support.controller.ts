import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SupportTicket } from './support.model'
import { requireTenant } from '../../middlewares/auth'
import { randomInt } from 'crypto'
import { sanitizeRichText } from '../../helpers/sanitize'

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const ticketId = `TCK-${randomInt(100000, 1000000)}`

  const ticket = await SupportTicket.create({
    ...req.body,
    description: sanitizeRichText(req.body.description),
    organizationId,
    ticketId,
    userId: req.user?._id,
  })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Support ticket created successfully',
    data: ticket,
  })
})

const getMyTickets = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const tickets = await SupportTicket.find({ organizationId }).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Support tickets fetched successfully',
    data: tickets,
  })
})

const replyToTicket = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { message } = req.body
  const role = req.user?.userRole || req.user?.role
  const sender = role === 'super-admin' ? 'support' : 'user'

  const ticket = await SupportTicket.findOne(req.user?.userRole === 'super-admin' ? { _id: id } : { _id: id, organizationId: requireTenant(req) })
  if (!ticket) {
    res.status(httpStatus.NOT_FOUND).json({ success: false, message: 'Ticket not found' })
    return
  }

  ticket.messages.push({
    sender,
    message: sanitizeRichText(message),
    timestamp: new Date(),
  })

  if (sender === 'support' && ticket.status === 'open') {
    ticket.status = 'in_progress'
  }

  await ticket.save()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Reply sent successfully',
    data: ticket,
  })
})

const updateTicketStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { status, priority } = req.body

  const ticket = await SupportTicket.findOne(req.user?.userRole === 'super-admin' ? { _id: id } : { _id: id, organizationId: requireTenant(req) })
  if (!ticket) {
    res.status(httpStatus.NOT_FOUND).json({ success: false, message: 'Ticket not found' })
    return
  }

  if (status) ticket.status = status
  if (priority) ticket.priority = priority

  await ticket.save()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Ticket updated successfully',
    data: ticket,
  })
})

const getAllTicketsSuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const tickets = await SupportTicket.find({}).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'All platform support tickets fetched successfully',
    data: tickets,
  })
})

export const SupportController = {
  createTicket,
  getMyTickets,
  replyToTicket,
  updateTicketStatus,
  getAllTicketsSuperAdmin,
}
