import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { TeamInvitationService } from './teamInvitation.service'

const invite = catchAsync(async (req: Request, res: Response) => {
  const data = await TeamInvitationService.createInvitation(requireTenant(req), req.user!._id!, req.body)
  sendResponse(res, { statusCode: 201, success: true, message: 'Invitation email sent successfully', data })
})
const accept = catchAsync(async (req: Request, res: Response) => {
  const data = await TeamInvitationService.acceptInvitation(req.body.token, req.body.password)
  sendResponse(res, { statusCode: 201, success: true, message: 'Invitation accepted successfully', data })
})
const pending = catchAsync(async (req: Request, res: Response) => {
  const data = await TeamInvitationService.listPending(requireTenant(req))
  sendResponse(res, { statusCode: 200, success: true, message: 'Pending invitations fetched successfully', data })
})
export const TeamInvitationController = { invite, accept, pending }
