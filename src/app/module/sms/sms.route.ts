import express, { Request, Response } from 'express'
import httpStatus from 'http-status'
import { authMiddlewares } from '../../middlewares/auth'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { logger } from '../../../shared/logger'

const router = express.Router()

const sendSmsHandler = catchAsync(async (req: Request, res: Response) => {
  const { phone, message } = req.body
  logger.info(`[SMS Notification] To: ${phone}, Message: "${message}"`)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'SMS notification dispatched',
    data: { phone, message, status: 'delivered' },
  })
})

router.post(
  '/send',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client'),
  sendSmsHandler
)

export const SmsRoute = router
