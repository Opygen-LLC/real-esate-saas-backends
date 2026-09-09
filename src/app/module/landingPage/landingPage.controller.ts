import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { LandingPage } from './landingPage.model'
import { requireTenant } from '../../middlewares/auth'
import ApiError from '../../../errors/ApiError'
import { sanitizeRichText } from '../../helpers/sanitize'
import { tenantResourceFilter } from '../../repositories/tenantRepository'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { serializePublicLandingPage } from './landingPage.serializer'

const sanitizePayload = (payload: Record<string, unknown>) => ({
  ...payload,
  ...(typeof payload.content === 'string' ? { content: sanitizeRichText(payload.content) } : {}),
})

const createLandingPage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await LandingPage.create({ ...sanitizePayload(req.body), organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Landing page created successfully',
    data: result,
  })
})

const getLandingPages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await LandingPage.find({ organizationId }).sort({ createdAt: -1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing pages fetched successfully',
    data: result,
  })
})

const getPublicLandingPages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = String(req.params.organizationId || '').trim()
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  const rows = await LandingPage.find({ organizationId, status: true })
    .sort({ createdAt: -1 })
    .select('_id title slug content metaTitle metaDescription status')
    .lean()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing pages fetched successfully',
    data: rows.map(serializePublicLandingPage),
  })
})

const updateLandingPage = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await LandingPage.findOneAndUpdate(
    tenantResourceFilter(requireTenant(req), id),
    { $set: sanitizePayload(req.body) },
    { new: true, runValidators: true },
  )
  if (!result) throw new ApiError(404, 'Landing page not found')

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Landing page updated successfully',
    data: result,
  })
})

const deleteLandingPage = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await LandingPage.findOneAndDelete(tenantResourceFilter(requireTenant(req), id))
  if (!result) throw new ApiError(404, 'Landing page not found')

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
  getPublicLandingPages,
  updateLandingPage,
  deleteLandingPage,
}
