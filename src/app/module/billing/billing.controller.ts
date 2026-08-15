import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { BillingService } from './billing.service'
import { requireTenant } from '../../middlewares/auth'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'

const getBillingHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getBillingHistory(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Manual subscription payment history fetched successfully', data: result })
})

const getSubscriptionUsage = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getSubscriptionUsage(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription usage and pending payment state fetched successfully', data: result })
})

const changeSubscriptionPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPaymentService.createChangeRequest(requireTenant(req), req.user!._id!, req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Plan change requested. Complete the manual payment instructions and wait for platform confirmation.', data: result })
})

const getChangeRequests = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPaymentService.getChangeRequests(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription change requests fetched successfully', data: result })
})

const cancelChangeRequest = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPaymentService.cancelChangeRequest(requireTenant(req), req.params.id, req.user!._id!)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription request cancelled', data: result })
})

const cancelSubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.cancelSubscription(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription will cancel at the end of the current period', data: result })
})

const getInvoiceReceipt = catchAsync(async (req: Request, res: Response) => {
  const html = await BillingService.getInvoiceReceipt(requireTenant(req), req.params.id)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(httpStatus.OK).send(html)
})

export const BillingController = { getBillingHistory, getSubscriptionUsage, changeSubscriptionPlan, getChangeRequests, cancelChangeRequest, cancelSubscription, getInvoiceReceipt }
