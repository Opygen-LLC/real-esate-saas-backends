import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Banner } from './banner.model'
import { requireTenant } from '../../middlewares/auth'
import ApiError from '../../../errors/ApiError'
import { tenantResourceFilter } from '../../repositories/tenantRepository'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'

const createBanner = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await Banner.create({ ...req.body, organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Banner created successfully',
    data: result,
  })
})

const getBanners = catchAsync(async (req: Request, res: Response) => {
  const organizationId = req.params.organizationId || requireTenant(req)
  if (req.params.organizationId) await TenantAccessService.assertPublicWebsiteAccess(organizationId)
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
  const { organizationId: _ignored, ...safeBody } = req.body
  const result = await Banner.findOneAndUpdate(tenantResourceFilter(requireTenant(req), id), safeBody, { new: true })
  if (!result) throw new ApiError(404, 'Banner not found')

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Banner updated successfully',
    data: result,
  })
})

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await Banner.findOneAndDelete(tenantResourceFilter(requireTenant(req), id))
  if (!result) throw new ApiError(404, 'Banner not found')

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
