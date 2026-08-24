import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { BillingService } from './billing.service'
import { requireTenant } from '../../middlewares/auth'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'
import { SubscriptionQuoteService } from '../subscription/subscriptionQuote.service'

const getBillingHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getBillingHistory(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Manual subscription payment history fetched successfully', data: result.data, meta: result.meta })
})

const getSubscriptionUsage = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getSubscriptionUsage(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription usage and pending payment state fetched successfully', data: result })
})


const getSubscriptionQuote = catchAsync(async (req: Request, res: Response) => {
  const quote = await SubscriptionQuoteService.quote(requireTenant(req), req.body)
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Authoritative subscription change quote calculated successfully',
    data: SubscriptionQuoteService.toPublicQuote(quote),
  })
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

const cancelScheduledDowngrade = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.cancelScheduledDowngrade(requireTenant(req), req.user!._id!)
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.financialAdjustmentRequired
      ? 'Scheduled downgrade cancelled. The active plan is unchanged; the confirmed payment remains in the billing ledger for support adjustment.'
      : 'Scheduled downgrade cancelled. The active plan is unchanged.',
    data: result,
  })
})

const cancelSubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.cancelSubscription(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription will cancel at the end of the current period', data: result })
})


const getUnacknowledgedConfirmation = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPaymentService.getUnacknowledgedConfirmation(requireTenant(req), req.user!._id!)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription confirmation state fetched successfully', data: result })
})

const acknowledgeSubscriptionConfirmation = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPaymentService.acknowledgeConfirmation(requireTenant(req), req.user!._id!, req.params.paymentNumber)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription confirmation acknowledged', data: result })
})

const getInvoiceReceipt = catchAsync(async (req: Request, res: Response) => {
  const receipt = await BillingService.getInvoiceReceipt(requireTenant(req), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${receipt.fileName}"`)
  res.setHeader('Content-Length', String(receipt.buffer.length))
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(httpStatus.OK).send(receipt.buffer)
})

export const BillingController = { getBillingHistory, getSubscriptionUsage, getSubscriptionQuote, changeSubscriptionPlan, getChangeRequests, cancelChangeRequest, cancelScheduledDowngrade, cancelSubscription, getUnacknowledgedConfirmation, acknowledgeSubscriptionConfirmation, getInvoiceReceipt }
