import { Request, Response } from 'express'
import mongoose from 'mongoose'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { PropertyService } from './property.service'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import { WebsiteBuilderService } from '../websiteBuilder/websiteBuilder.service'
import ApiError from '../../../errors/ApiError'
import { PropertyImportService } from './propertyImport.service'
import config from '../../../config'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { logger } from '../../../shared/logger'
import { Organization } from '../organization/organization.model'


const propertyActor = (req: Request) => ({
  id: String(req.user?._id || req.user?.id || ''),
  role: req.user?.userRole || req.user?.role || req.tenant?.role,
  canPublish: Boolean(req.tenant?.permissions.includes('properties.publish')),
})

const propertyExportFilters = (req: Request) => pick(req.query, [
  'searchTerm', 'propertyType', 'listingType', 'status', 'city', 'state', 'divisionId', 'districtId', 'upazilaId',
  'minPrice', 'maxPrice', 'bedrooms', 'bathrooms', 'minArea', 'maxArea', 'furnished', 'isFeatured', 'agentId',
])

const previewImport = catchAsync(async (req: Request, res: Response) => {
  const actor = propertyActor(req)
  if (!actor.id) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication is required')
  const data = await PropertyImportService.preview(requireTenant(req), { ...actor, id: actor.id }, req.file)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property import preview generated successfully', data })
})

const confirmImport = catchAsync(async (req: Request, res: Response) => {
  const actor = propertyActor(req)
  if (!actor.id) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication is required')
  const data = await PropertyImportService.confirm(requireTenant(req), { ...actor, id: actor.id }, req.body.importSessionId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property import completed', data })
})

const downloadImportCsvTemplate = catchAsync(async (_req: Request, res: Response) => {
  res.status(httpStatus.OK).setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', 'attachment; filename="opygen-property-import-template.csv"')
  res.send(`\uFEFF${PropertyImportService.csvTemplate()}`)
})

const downloadImportXlsxTemplate = catchAsync(async (_req: Request, res: Response) => {
  const buffer = await PropertyImportService.xlsxTemplate()
  res.status(httpStatus.OK).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('content-disposition', 'attachment; filename="opygen-property-import-template.xlsx"')
  res.send(buffer)
})

const exportCsv = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const filters = propertyExportFilters(req)
  const sortOptions = pick(req.query, ['sortBy', 'sortOrder'])
  const csv = await PropertyService.exportCsv(organizationId, filters, sortOptions)
  res.status(httpStatus.OK).setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="properties-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(`\uFEFF${csv}`)
})

const exportXlsx = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const filters = propertyExportFilters(req)
  const sortOptions = pick(req.query, ['sortBy', 'sortOrder'])
  const workbook = await PropertyService.exportXlsx(organizationId, filters, sortOptions)
  res.status(httpStatus.OK).setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('content-disposition', `attachment; filename="properties-${new Date().toISOString().slice(0, 10)}.xlsx"`)
  res.send(workbook)
})

const emitCreatedAfterCommit = (organizationId: string, result: any, requestId?: string) => {
  // Property persistence is the critical path. Audit/realtime publication is a
  // post-commit side effect and must never keep the HTTP request open long
  // enough for the reverse proxy to turn a successful save into a 502/504.
  void PropertyService.emitPropertyCreated(organizationId, result).catch((error) => {
    logger.error('property_post_commit_event_failed', {
      organizationId,
      propertyId: result?._id?.toString(),
      requestId,
      error,
    })
  })
}

const createProperty = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { propertyDraftSessionId, ...propertyPayload } = req.body
  const actor = {
    id: req.user?._id || req.user?.id,
    role: req.user?.userRole || req.user?.role || req.tenant?.role,
    canPublish: Boolean(req.tenant?.permissions.includes('properties.publish')),
  }

  let result: any
  if (propertyDraftSessionId) {
    // A gateway can lose the response after the Mongo transaction commits.
    // Treat the persistent draft-session id as an idempotency key: if its
    // assets are already claimed by one property, return that property instead
    // of creating a duplicate or failing the user's retry with a 409.
    const existingDraft = await WebsiteBuilderService.getPropertyDraftSession(organizationId, propertyDraftSessionId)
    if (existingDraft.claimedPropertyId) {
      result = await PropertyService.getPropertyById(organizationId, existingDraft.claimedPropertyId)
      sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: 'Property listing was already created from this draft',
        data: result,
      })
      return
    }

    const canTransact = await mongoSupportsTransactions()
    if (config.isProduction && !canTransact) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Atomic property media claiming requires MongoDB transactions in production')
    const session = canTransact ? await mongoose.startSession() : null
    const execute = async () => {
      if (session) {
        const lock = await Organization.updateOne({ organizationId }, { $inc: { propertyQuotaRevision: 1 } }, { session })
        if (!lock.matchedCount) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
      }
      await EntitlementService.assertPropertyCapacity(organizationId, { additionalCommitments: 1, session: session || undefined })
      await WebsiteBuilderService.validatePropertyDraftAssets(organizationId, propertyDraftSessionId, propertyPayload.images || [], session)
      result = await PropertyService.createProperty(organizationId, propertyPayload, actor, { session, emitEvent: false })
      await WebsiteBuilderService.claimPropertyDraftAssets(organizationId, propertyDraftSessionId, result._id.toString(), propertyPayload.images || [], session)
    }
    try {
      if (session) await session.withTransaction(execute)
      else await execute()
    } finally {
      if (session) await session.endSession()
    }
    emitCreatedAfterCommit(organizationId, result, req.requestId)
    void WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, propertyDraftSessionId).catch((error) => {
      logger.warn('[property-media] post-create draft cleanup deferred to worker', { organizationId, propertyId: result?._id?.toString(), error })
    })
  } else {
    result = await EntitlementService.withPropertyQuotaGuard(organizationId, async (session) => {
      await EntitlementService.assertPropertyCapacity(organizationId, { additionalCommitments: 1, session })
      return PropertyService.createProperty(organizationId, propertyPayload, actor, { session, emitEvent: false })
    })
    emitCreatedAfterCommit(organizationId, result, req.requestId)
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Property listing created successfully',
    data: result,
  })
})



const presignPropertyImage = catchAsync(async (req: Request, res: Response) => {
  const { uploadSessionId, ...assetPayload } = req.body
  const data = await WebsiteBuilderService.presignAsset(requireTenant(req), assetPayload, uploadSessionId ? { context: 'property-draft', uploadSessionId } : {})
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Property image upload prepared', data })
})
const uploadPropertyImage = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(httpStatus.BAD_REQUEST, 'No property photo was uploaded')
  const uploadSessionId = String(req.body?.uploadSessionId || '').trim()
  const data = await WebsiteBuilderService.uploadAssetBuffer(
    requireTenant(req),
    req.file,
    req.user?._id,
    uploadSessionId ? { context: 'property-draft', uploadSessionId } : {},
  )
  sendResponse(res, { statusCode: httpStatus.ACCEPTED, success: true, message: 'Property image uploaded and queued for verification', data })
})

const completePropertyImage = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.completeAsset(requireTenant(req), req.body, req.user?._id)
  sendResponse(res, { statusCode: httpStatus.ACCEPTED, success: true, message: 'Property image uploaded and queued for verification', data })
})
const getPropertyImageAsset = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.getAssetById(requireTenant(req), req.params.assetId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property image status fetched', data })
})

const importPropertyImageUrl = catchAsync(async (req: Request, res: Response) => {
  const { uploadSessionId, ...assetPayload } = req.body
  const data = await WebsiteBuilderService.importAssetFromUrl(requireTenant(req), assetPayload, req.user?._id, uploadSessionId ? { context: 'property-draft', uploadSessionId } : {})
  sendResponse(res, { statusCode: httpStatus.ACCEPTED, success: true, message: 'Property image imported and queued for verification', data })
})

const deletePropertyDraftAsset = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.deletePropertyDraftAsset(requireTenant(req), req.params.sessionId, req.params.assetId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: data.deleted ? 'Draft property image deleted' : 'Draft property image already removed', data })
})

const getPropertyDraftSession = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.getPropertyDraftSession(requireTenant(req), req.params.sessionId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property draft media session reconciled', data })
})

const touchPropertyDraftSession = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.touchPropertyDraftSession(requireTenant(req), req.params.sessionId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property draft media session refreshed', data })
})

const cleanupPropertyDraftSession = catchAsync(async (req: Request, res: Response) => {
  const data = await WebsiteBuilderService.cleanupPropertyDraftSession(requireTenant(req), req.params.sessionId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property draft media cleaned up', data })
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
    'divisionId',
    'districtId',
    'upazilaId',
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
  filters.organizationId = requireTenant(req)

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder', 'cursor'])
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
    'divisionId',
    'districtId',
    'upazilaId',
    'status',
    'minPrice',
    'maxPrice',
    'bedrooms',
    'bathrooms',
    'isFeatured',
  ])
  filters.organizationId = organizationId

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder', 'cursor'])
  const result = await PropertyService.getPublicProperties(organizationId, filters, paginationOptions)

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
  const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : ''
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Tenant context is required for public property details', '', 'TENANT_CONTEXT_REQUIRED')
  }
  const result = await PropertyService.getPublicPropertyDetail(id, organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public property details and recommendations fetched successfully',
    data: result,
  })
})

const getPropertyById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
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
  const organizationId = requireTenant(req)
  const { id } = req.params
  const { propertyDraftSessionId, ...propertyPayload } = req.body
  const actor = propertyActor(req)

  let result: any
  if (propertyDraftSessionId) {
    const previous: any = await PropertyService.getPropertyById(organizationId, id)
    const canTransact = await mongoSupportsTransactions()
    if (config.isProduction && !canTransact) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Atomic property media claiming requires MongoDB transactions in production')
    const session = canTransact ? await mongoose.startSession() : null
    const execute = async () => {
      await WebsiteBuilderService.validatePropertyDraftAssets(organizationId, propertyDraftSessionId, propertyPayload.images || [], session, id)
      result = await PropertyService.updateProperty(organizationId, id, propertyPayload, actor, { session, emitEvent: false })
      await WebsiteBuilderService.claimPropertyDraftAssets(organizationId, propertyDraftSessionId, id, propertyPayload.images || [], session)
    }
    try {
      if (session) await session.withTransaction(execute)
      else await execute()
    } finally {
      if (session) await session.endSession()
    }
    if (result) {
      await PropertyService.emitPropertyUpdated(
        organizationId,
        result,
        String(previous?.status || result.status),
        Object.keys(propertyPayload),
      )
    }
    void WebsiteBuilderService.cleanupPropertyDraftSession(organizationId, propertyDraftSessionId).catch((error) => {
      logger.warn('[property-media] post-update draft cleanup deferred to worker', { organizationId, propertyId: id, error })
    })
  } else {
    result = await PropertyService.updateProperty(organizationId, id, propertyPayload, actor)
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property listing updated successfully',
    data: result,
  })
})

const updatePropertyStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const { status } = req.body
  const result = await PropertyService.updatePropertyStatus(organizationId, id, status, {
    id: req.user?._id || req.user?.id,
    role: req.user?.userRole || req.user?.role || req.tenant?.role,
    canPublish: Boolean(req.tenant?.permissions.includes('properties.publish')),
  })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Property status updated successfully',
    data: result,
  })
})


const updatePropertyQuotaAccess = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await PropertyService.setQuotaAccess(
    organizationId,
    id,
    Boolean(req.body.active),
    String(req.user?._id || req.user?.id || 'tenant-admin'),
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: req.body.active ? 'Property unlocked for active inventory' : 'Property locked from active inventory',
    data: result,
  })
})

const reorderPropertyImages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
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
  const organizationId = requireTenant(req)
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
  importPropertyImageUrl,
  presignPropertyImage,
  uploadPropertyImage,
  completePropertyImage,
  getPropertyImageAsset,
  deletePropertyDraftAsset,
  getPropertyDraftSession,
  touchPropertyDraftSession,
  cleanupPropertyDraftSession,
  getAllProperties,
  getPublicProperties,
  getPublicPropertyDetail,
  getPropertyById,
  getPublicPropertyBySlug,
  updateProperty,
  updatePropertyStatus,
  updatePropertyQuotaAccess,
  reorderPropertyImages,
  deleteProperty,
  previewImport,
  confirmImport,
  downloadImportCsvTemplate,
  downloadImportXlsxTemplate,
  exportCsv,
  exportXlsx,
}
