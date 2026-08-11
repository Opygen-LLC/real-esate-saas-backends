import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SupportTicket } from './support.model'

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const ticketId = 'TCK-' + Math.floor(100000 + Math.random() * 900000)

  const ticket = await SupportTicket.create({
    ...req.body,
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
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const tickets = await SupportTicket.find({ organizationId }).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Support tickets fetched successfully',
    data: tickets,
  })
})

export const SupportController = {
  createTicket,
  getMyTickets,
}
