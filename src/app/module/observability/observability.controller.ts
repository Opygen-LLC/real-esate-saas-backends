import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { ObservabilityService } from './observability.service'

const clientError = catchAsync(async (req: Request, res: Response) => {
  const data = await ObservabilityService.reportClientError({ ...req.body, userAgent: req.get('user-agent') || req.body?.userAgent })
  res.status(202).json({ success: true, message: 'Error report accepted', data })
})

export const ObservabilityController = { clientError }
