import express, { Request, Response } from 'express'
import httpStatus from 'http-status'
import { authMiddlewares } from '../../middlewares/auth'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { sendSms } from '../../helpers/sendOtp'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import validateRequest from '../../middlewares/validateRequest'
import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'

const router = express.Router()

const sendSmsHandler = catchAsync(async (req: Request, res: Response) => {
  const { phone, message } = req.body
  await EntitlementService.assertFeature(requireTenant(req), 'smsAutomation')
  await sendSms(normalizeBangladeshPhone(phone), message)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'SMS notification dispatched',
    data: { status: 'accepted' },
  })
})

router.post(
  '/send',
  authMiddlewares.auth(),
  validateRequest(z.object({ body: z.object({ phone: z.string().refine(value => { try { normalizeBangladeshPhone(value); return true } catch { return false } }), message: z.string().trim().min(1).max(480) }) })),
  sendSmsHandler
)

export const SmsRoute = router
