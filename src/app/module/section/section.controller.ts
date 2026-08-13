import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Section } from './section.model'
import { requireTenant } from '../../middlewares/auth'
import ApiError from '../../../errors/ApiError'
import { tenantResourceFilter } from '../../repositories/tenantRepository'

const createSection = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await Section.create({ ...req.body, organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Section created successfully',
    data: result,
  })
})

const getSections = catchAsync(async (req: Request, res: Response) => {
  const organizationId = req.params.organizationId || requireTenant(req)
  const result = await Section.find({ organizationId }).sort({ order: 1 })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sections fetched successfully',
    data: result,
  })
})

const updateSection = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const { organizationId: _ignored, ...safeBody } = req.body
  const result = await Section.findOneAndUpdate(tenantResourceFilter(requireTenant(req), id), safeBody, { new: true })
  if (!result) throw new ApiError(404, 'Section not found')

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Section updated successfully',
    data: result,
  })
})

const deleteSection = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await Section.findOneAndDelete(tenantResourceFilter(requireTenant(req), id))
  if (!result) throw new ApiError(404, 'Section not found')

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Section deleted successfully',
    data: result,
  })
})

export const SectionController = {
  createSection,
  getSections,
  updateSection,
  deleteSection,
}
