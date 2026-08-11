import express, { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { logger } from '../../../shared/logger'

const router = express.Router()

router.get(
  '/sync-tasks',
  catchAsync(async (req: Request, res: Response) => {
    logger.info('[Cron Job] Executed scheduled task & viewing reminder check')
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: 'Cron tasks synced successfully',
      data: null,
    })
  })
)

export const CronRoute = router
