import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { NotificationService } from './notification.service'

const userId = (req: Request) => String(req.user?._id || req.user?.id || '')

const list = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.list(requireTenant(req), userId(req), {
    limit: Number(req.query.limit || 20),
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
  })
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Notifications fetched',
    meta: result.meta,
    data: result.data,
  })
})

const markRead = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Notification marked read',
  data: await NotificationService.markRead(requireTenant(req), userId(req), req.params.id),
}))

const markAllRead = catchAsync(async (req: Request, res: Response) => {
  await NotificationService.markAllRead(requireTenant(req), userId(req))
  sendResponse(res, { statusCode: 200, success: true, message: 'Notifications marked read', data: null })
})

const dismiss = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: 200,
  success: true,
  message: 'Notification dismissed',
  data: await NotificationService.dismiss(requireTenant(req), userId(req), req.params.id),
}))

export const NotificationController = { list, markRead, markAllRead, dismiss }
