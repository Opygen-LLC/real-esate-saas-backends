import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { LandingPage } from './landingPage.model'

const createLandingPage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await LandingPage.create({ ...req.body, organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Landing page created successfully',
    data: result,
  })
})

const getLandingPages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.params.organizationId || req.user?.organizationId || req.user?.storeId) as string
  const result = await LandingPage.find({ organizationId }).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing pages fetched successfully',
    data: result,
  })
})

const updateLandingPage = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await LandingPage.findByIdAndUpdate(id, req.body, { new: true })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing page updated successfully',
    data: result,
  })
})

const deleteLandingPage = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await LandingPage.findByIdAndDelete(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing page deleted successfully',
    data: result,
  })
})

export const LandingPageController = {
  createLandingPage,
  getLandingPages,
  updateLandingPage,
  deleteLandingPage,
}
