import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { LandingPage } from './landingPage.model'
import { requireTenant } from '../../middlewares/auth'
import ApiError from '../../../errors/ApiError'
import { sanitizeRichText } from '../../helpers/sanitize'
import { tenantResourceFilter } from '../../repositories/tenantRepository'

const createLandingPage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await LandingPage.create({ ...req.body, content: sanitizeRichText(req.body.content || ''), organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Landing page created successfully',
    data: result,
  })
})

const getLandingPages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = req.params.organizationId || requireTenant(req)
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
  const { organizationId: _ignored, ...safeBody } = req.body
  if (typeof safeBody.content === 'string') safeBody.content = sanitizeRichText(safeBody.content)
  const result = await LandingPage.findOneAndUpdate(tenantResourceFilter(requireTenant(req), id), safeBody, { new: true })
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
  updateLandingPage,
  deleteLandingPage,
}
