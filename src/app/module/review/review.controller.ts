import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { ReviewService } from './review.service'

const createInvitation = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Review link created', data: await ReviewService.createInvitation(requireTenant(req), req.user!._id!, req.body.propertyId, req.body.expiresInDays) }))
const list = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Reviews fetched', data: await ReviewService.list(requireTenant(req)) }))
const getInvitation = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Review invitation fetched', data: await ReviewService.getInvitation(req.params.token) }))
const submit = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Thank you. Your review was submitted for approval.', data: await ReviewService.submit(req.body) }))
const moderate = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Review status updated', data: await ReviewService.moderate(requireTenant(req), req.params.id, req.body.status, req.user!._id!) }))
const remove = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Review deleted', data: await ReviewService.remove(requireTenant(req), req.params.id) }))
const revokeInvitation = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Review link revoked', data: await ReviewService.revokeInvitation(requireTenant(req), req.params.id) }))
const publicReviews = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Published reviews fetched', data: await ReviewService.getPublicReviews(req.params.organizationId) }))
export const ReviewController = { createInvitation, list, getInvitation, submit, moderate, remove, revokeInvitation, publicReviews }
