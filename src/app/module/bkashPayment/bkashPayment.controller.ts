import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { BkashPaymentService } from './bkashPayment.service'
import { requireTenant } from '../../middlewares/auth'

const createPayment = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const headerKey = req.get('Idempotency-Key')?.trim()
  const idempotencyKey = headerKey && headerKey.length <= 128 ? headerKey : `server-${randomUUID()}`

  const result = await BkashPaymentService.createPayment({
    organizationId,
    initiatedBy: req.user?._id,
    planId: req.body.planId,
    billingCycle: req.body.billingCycle,
    idempotencyKey,
  })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'bKash checkout created successfully',
    data: result,
  })
})

const callback = async (req: Request, res: Response): Promise<void> => {
  const paymentId = typeof req.query.paymentID === 'string' ? req.query.paymentID : ''
  const status = typeof req.query.status === 'string' ? req.query.status : ''
  const clientBase = config.client_url.replace(/\/$/, '')

  if (!paymentId || !status) {
    res.redirect(`${clientBase}/payment/bkash/failed?reason=missing_callback_parameters`)
    return
  }

  try {
    const result = await BkashPaymentService.handleCallback(paymentId, status)
    if (result.status === 'succeeded') {
      res.redirect(`${clientBase}/payment/bkash/success?paymentID=${encodeURIComponent(paymentId)}`)
      return
    }

    const reason = result.status === 'cancelled' ? 'cancelled' : result.status
    res.redirect(`${clientBase}/payment/bkash/failed?reason=${encodeURIComponent(reason)}`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'payment_verification_failed'
    res.redirect(`${clientBase}/payment/bkash/failed?reason=${encodeURIComponent(reason)}`)
  }
}

const getPaymentStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await BkashPaymentService.getPaymentStatus(organizationId, req.params.paymentId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Payment status fetched successfully',
    data: result,
  })
})

const searchPayments = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Payment attempts fetched', data: await BkashPaymentService.searchPayments(String(req.query.search || ''), req.query.status as string | undefined) }))
const manualReconcile = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true,
  message: 'Payment reconciled against bKash', data: await BkashPaymentService.manualReconcile(req.params.paymentId, req.body.reason,
    { id: req.user!._id!, requestId: req.requestId, ip: req.ip }) }))

export const BkashPaymentController = { createPayment, callback, getPaymentStatus, searchPayments, manualReconcile }
