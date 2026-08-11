import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Banner } from './banner.model'

const createBanner = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await Banner.create({ ...req.body, organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Banner created successfully',
    data: result,
  })
})

const getBanners = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.params.organizationId || req.user?.organizationId || req.user?.storeId) as string
  const result = await Banner.find({ organizationId }).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Banners fetched successfully',
    data: result,
  })
})

const updateBanner = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await Banner.findByIdAndUpdate(id, req.body, { new: true })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Banner updated successfully',
    data: result,
  })
})

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await Banner.findByIdAndDelete(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Banner deleted successfully',
    data: result,
  })
})

export const BannerController = {
  createBanner,
  getBanners,
  updateBanner,
  deleteBanner,
}
