import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { NotificationService } from './notification.service'
const userId = (req: Request) => String(req.user?._id || req.user?.id || '')
const list = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Notifications fetched', data: await NotificationService.list(requireTenant(req), userId(req), Number(req.query.limit || 20)) }))
const markRead = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Notification marked read', data: await NotificationService.markRead(requireTenant(req), userId(req), req.params.id) }))
const markAllRead = catchAsync(async (req: Request, res: Response) => { await NotificationService.markAllRead(requireTenant(req), userId(req)); sendResponse(res, { statusCode: 200, success: true, message: 'Notifications marked read', data: null }) })
export const NotificationController = { list, markRead, markAllRead }
