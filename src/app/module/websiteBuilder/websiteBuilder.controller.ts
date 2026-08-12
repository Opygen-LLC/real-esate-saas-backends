import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { WebsiteBuilderService } from './websiteBuilder.service'

const getAllPages = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const result = await WebsiteBuilderService.getAllPages(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Tenant website pages fetched successfully',
    data: result,
  })
})

const getPageById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await WebsiteBuilderService.getPageById(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Website page fetched successfully',
    data: result,
  })
})

const saveDraft = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const userId = req.user?.userId
  const { id } = req.params
  const { document } = req.body

  const result = await WebsiteBuilderService.saveDraft(organizationId, id, document, userId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Draft saved successfully',
    data: result,
  })
})

const publishPage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const userId = req.user?.userId
  const { id } = req.params

  const result = await WebsiteBuilderService.publishPage(organizationId, id, userId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Page published live successfully',
    data: result,
  })
})

const addAsset = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const userId = req.user?.userId

  const result = await WebsiteBuilderService.addAsset(organizationId, req.body, userId)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Website asset uploaded successfully',
    data: result,
  })
})

const deleteAsset = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params

  const result = await WebsiteBuilderService.deleteAsset(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Asset deleted successfully',
    data: result,
  })
})

const getPublicPage = catchAsync(async (req: Request, res: Response) => {
  const { subdomain, slug } = req.params
  const result = await WebsiteBuilderService.getPublicPage(subdomain, slug || '/')

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public published page fetched successfully',
    data: result,
  })
})

export const WebsiteBuilderController = {
  getAllPages,
  getPageById,
  saveDraft,
  publishPage,
  addAsset,
  deleteAsset,
  getPublicPage,
}
