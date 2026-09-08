import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { MaterialInventoryService } from './materialInventory.service'

const actorId = (req: Request) => String(req.user?._id || req.user?.id || '')

const listMaterials = catchAsync(async (req: Request, res: Response) => {
  const result = await MaterialInventoryService.listMaterials(requireTenant(req), req.query, pick(req.query, ['page', 'limit']))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Materials fetched successfully', meta: result.meta, data: result.data })
})

const createMaterial = catchAsync(async (req: Request, res: Response) => {
  const data = await MaterialInventoryService.createMaterial(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Material created successfully', data })
})

const getMaterial = catchAsync(async (req: Request, res: Response) => {
  const data = await MaterialInventoryService.getMaterial(requireTenant(req), req.params.materialId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material fetched successfully', data })
})

const updateMaterial = catchAsync(async (req: Request, res: Response) => {
  const data = await MaterialInventoryService.updateMaterial(requireTenant(req), req.params.materialId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material updated successfully', data })
})

const createRequirement = catchAsync(async (req: Request, res: Response) => {
  const data = await MaterialInventoryService.createRequirement(requireTenant(req), req.params.materialId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Material requirement created successfully', data })
})

const updateRequirement = catchAsync(async (req: Request, res: Response) => {
  const data = await MaterialInventoryService.updateRequirement(requireTenant(req), req.params.requirementId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material requirement updated successfully', data })
})

const createMovement = catchAsync(async (req: Request, res: Response) => {
  const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
  const data = await MaterialInventoryService.createMovement(requireTenant(req), req.params.materialId, actorId(req), req.body, headerKey)
  sendResponse(res, { statusCode: data.replayed ? httpStatus.OK : httpStatus.CREATED, success: true, message: data.replayed ? 'Stock movement already recorded' : 'Stock movement recorded successfully', data })
})

const listMovements = catchAsync(async (req: Request, res: Response) => {
  const result = await MaterialInventoryService.listMovements(requireTenant(req), req.params.materialId, req.query, pick(req.query, ['page', 'limit']))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Stock movements fetched successfully', meta: result.meta, data: result.data })
})

export const MaterialInventoryController = { listMaterials, createMaterial, getMaterial, updateMaterial, createRequirement, updateRequirement, createMovement, listMovements }
