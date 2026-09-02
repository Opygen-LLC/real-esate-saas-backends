import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { LocalizationService } from './localization.service'

const locations = catchAsync(async (req: Request, res: Response) => {
  const { level, parentId, locale = 'en', search = '' } = req.query as Record<string, string>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Bangladesh locations fetched',
    data: LocalizationService.getLocations(level as any, parentId, locale as any, search) })
})


const getAreaSummary = catchAsync(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Area conversion summary generated',
    data: LocalizationService.areaSummary(Number(q.value), q.from as any,
      q.kathaSqft ? Number(q.kathaSqft) : undefined, q.bighaKatha ? Number(q.bighaKatha) : undefined) })
})

const convertArea = catchAsync(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Area converted',
    data: LocalizationService.convertArea(Number(q.value), q.from as any, q.to as any,
      q.kathaSqft ? Number(q.kathaSqft) : undefined, q.bighaKatha ? Number(q.bighaKatha) : undefined) })
})

export const LocalizationController = { locations, convertArea, getAreaSummary }
