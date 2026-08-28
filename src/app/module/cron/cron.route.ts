import express, { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { logger } from '../../../shared/logger'
import { runPhase3Maintenance } from './phase3.worker'

const router = express.Router()

router.get(
  '/sync-tasks',
  catchAsync(async (_req: Request, res: Response) => {
    // The worker is now the single batch owner for subscription lifecycle
    // reconciliation. Keeping the cron endpoint as a manual/hosted trigger is
    // useful, but it must not run a second independent reconciliation pass.
    const phase3 = await runPhase3Maintenance()
    const subscriptions = 'subscriptionLifecycle' in phase3
      ? phase3.subscriptionLifecycle
      : { skipped: true }
    const result = { subscriptions, phase3 }
    logger.info('[Cron Job] Maintenance completed', result)
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: 'Cron tasks synced successfully',
      data: result,
    })
  })
)

export const CronRoute = router
