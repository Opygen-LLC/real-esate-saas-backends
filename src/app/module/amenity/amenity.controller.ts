import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { AmenityService } from './amenity.service'
import { requireTenant } from '../../middlewares/auth'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'

const getAllAmenities = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.params.organizationId || req.user?.organizationId || req.user?.storeId) as string
  if (req.params.organizationId) await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  const result = await AmenityService.getAllAmenities(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Amenities fetched successfully',
    data: result,
  })
})

const createAmenity = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await AmenityService.createAmenity(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Amenity created successfully',
    data: result,
  })
})

const deleteAmenity = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await AmenityService.deleteAmenity(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Amenity deleted successfully',
    data: result,
  })
})

export const AmenityController = {
  getAllAmenities,
  createAmenity,
  deleteAmenity,
}
