import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { OrganizationService } from './organization.service'
import { requireTenant } from '../../middlewares/auth'
import { writeAudit } from '../audit/audit.service'

const getMyOrganization = catchAsync(async (req: Request, res: Response) => {
  const result = await OrganizationService.getMyOrganization(requireTenant(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Organization fetched successfully',
    data: result,
  })
})

const updateMyOrganization = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body
  const result = await OrganizationService.updateMyOrganization(requireTenant(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Organization updated successfully',
    data: result,
  })
})

const getOrganizationByDomain = catchAsync(async (req: Request, res: Response) => {
  const { domain } = req.params
  const result = await OrganizationService.getOrganizationByDomain(domain)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Organization fetched successfully by domain',
    data: result,
  })
})

const getPublicSiteInfo = catchAsync(async (req: Request, res: Response) => {
  const { identifier } = req.params
  const result = await OrganizationService.getPublicSiteInfo(identifier)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public website details and branding fetched successfully',
    data: result,
  })
})

const updateWebsiteSettings = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await OrganizationService.updateWebsiteSettings(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Website customizer settings saved successfully',
    data: result,
  })
})

const getAllOrganizations = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'agencyType', 'status'])
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await OrganizationService.getAllOrganizations(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'All organizations fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const updateOrganizationBySuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason, ...payload } = req.body
  const result = await OrganizationService.updateOrganizationBySuperAdmin(id, payload)
  await writeAudit({ organizationId: result?.organizationId, actorId: req.user!._id!, actorRole: 'super-admin', action: 'organization.platform_updated', entityType: 'organization',
    entityId: id, reason, requestId: req.requestId, ip: req.ip, metadata: { fields: Object.keys(payload) } })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Organization updated successfully by super admin',
    data: result,
  })
})

export const OrganizationController = {
  getMyOrganization,
  updateMyOrganization,
  getOrganizationByDomain,
  getPublicSiteInfo,
  updateWebsiteSettings,
  getAllOrganizations,
  updateOrganizationBySuperAdmin,
}
