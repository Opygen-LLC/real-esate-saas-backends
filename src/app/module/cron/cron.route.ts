import express, { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { logger } from '../../../shared/logger'
import { reconcileSubscriptions } from '../subscription/subscriptionLifecycle.service'

const router = express.Router()

router.get(
  '/sync-tasks',
  catchAsync(async (req: Request, res: Response) => {
    const result = await reconcileSubscriptions()
    logger.info('[Cron Job] Subscription and payment reconciliation completed', result)
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: 'Cron tasks synced successfully',
      data: result,
    })
  })
)

export const CronRoute = router
