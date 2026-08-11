import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Section } from './section.model'

const createSection = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await Section.create({ ...req.body, organizationId })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Section created successfully',
    data: result,
  })
})

const getSections = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.params.organizationId || req.user?.organizationId || req.user?.storeId) as string
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
  const result = await Section.findByIdAndUpdate(id, req.body, { new: true })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Section updated successfully',
    data: result,
  })
})

const deleteSection = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await Section.findByIdAndDelete(id)

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
