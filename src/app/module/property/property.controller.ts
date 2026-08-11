import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { PropertyService } from './property.service'

const createProperty = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await PropertyService.createProperty(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Property listing created successfully',
    data: result,
  })
})

const getAllProperties = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, [
    'searchTerm',
    'organizationId',
    'propertyType',
    'listingType',
    'status',
    'city',
    'state',
    'minPrice',
    'maxPrice',
    'bedrooms',
    'bathrooms',
    'minArea',
    'maxArea',
    'furnished',
    'isFeatured',
    'agentId',
  ])

  // Org scoping
  if (req.user && req.user.userRole !== 'super-admin' && (req.user.organizationId || req.user.storeId)) {
    filters.organizationId = req.user.organizationId || req.user.storeId
  } else if (req.query.organizationId) {
    filters.organizationId = req.query.organizationId as string
  }

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await PropertyService.getAllProperties(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Properties fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getPublicProperties = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.params
  const filters = pick(req.query, [
    'searchTerm',
    'propertyType',
    'listingType',
    'city',
    'state',
    'minPrice',
    'maxPrice',
    'bedrooms',
    'bathrooms',
    'isFeatured',
  ])
  filters.organizationId = organizationId
  filters.status = 'Available'

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await PropertyService.getAllProperties(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public properties fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getPublicPropertyDetail = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await PropertyService.getPublicPropertyDetail(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public property details and recommendations fetched successfully',
    data: result,
  })
})

const getPropertyById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.query.organizationId) as string
  const { id } = req.params
  const result = await PropertyService.getPropertyById(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property details fetched successfully',
    data: result,
  })
})

const getPublicPropertyBySlug = catchAsync(async (req: Request, res: Response) => {
  const { organizationId, slug } = req.params
  const result = await PropertyService.getPropertyBySlug(organizationId, slug)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property fetched successfully by slug',
    data: result,
  })
})

const updateProperty = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await PropertyService.updateProperty(organizationId, id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property listing updated successfully',
    data: result,
  })
})

const updatePropertyStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const { status } = req.body
  const result = await PropertyService.updatePropertyStatus(organizationId, id, status)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property status updated successfully',
    data: result,
  })
})

const reorderPropertyImages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const { images } = req.body
  const result = await PropertyService.reorderPropertyImages(organizationId, id, images)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property media gallery reordered successfully',
    data: result,
  })
})

const deleteProperty = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await PropertyService.deleteProperty(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property listing deleted successfully',
    data: result,
  })
})

export const PropertyController = {
  createProperty,
  getAllProperties,
  getPublicProperties,
  getPublicPropertyDetail,
  getPropertyById,
  getPublicPropertyBySlug,
  updateProperty,
  updatePropertyStatus,
  reorderPropertyImages,
  deleteProperty,
}
