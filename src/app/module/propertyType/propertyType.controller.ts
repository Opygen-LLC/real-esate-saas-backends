import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { PropertyTypeService } from './propertyType.service'
import { requireTenant } from '../../middlewares/auth'

const getAllPropertyTypes = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.params.organizationId || req.user?.organizationId || req.user?.storeId) as string
  const result = await PropertyTypeService.getAllPropertyTypes(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property types fetched successfully',
    data: result,
  })
})

const createPropertyType = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await PropertyTypeService.createPropertyType(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Property type created successfully',
    data: result,
  })
})

const deletePropertyType = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await PropertyTypeService.deletePropertyType(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property type deleted successfully',
    data: result,
  })
})

export const PropertyTypeController = {
  getAllPropertyTypes,
  createPropertyType,
  deletePropertyType,
}
