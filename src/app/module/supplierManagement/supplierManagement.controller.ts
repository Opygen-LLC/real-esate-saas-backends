import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { SupplierInvoiceAttachmentService } from './supplierInvoiceAttachment.service'
import { SupplierManagementService } from './supplierManagement.service'

const actorId = (req: Request) => String(req.user?._id || req.user?.id || '')

const listSuppliers = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierManagementService.listSuppliers(requireTenant(req), req.query, pick(req.query, ['page', 'limit']))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Suppliers fetched successfully', meta: result.meta, data: result.data })
})
const availableVendors = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.listAvailableVendors(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Available vendors fetched successfully', data })
})
const materialOptions = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.listMaterialOptions(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material options fetched successfully', data })
})
const createSupplier = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.createSupplier(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Supplier created successfully', data })
})
const getSupplier = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.getSupplierProfile(requireTenant(req), req.params.supplierId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Supplier profile fetched successfully', data })
})
const updateSupplier = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.updateSupplier(requireTenant(req), req.params.supplierId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Supplier updated successfully', data })
})
const listPurchases = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierManagementService.listPurchases(requireTenant(req), req.query, pick(req.query, ['page', 'limit']))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material purchases fetched successfully', meta: result.meta, data: result.data })
})
const createPurchase = catchAsync(async (req: Request, res: Response) => {
  const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
  const result = await SupplierManagementService.createPurchase(requireTenant(req), actorId(req), req.body, headerKey)
  sendResponse(res, { statusCode: result.replayed ? httpStatus.OK : httpStatus.CREATED, success: true, message: result.replayed ? 'Material purchase already recorded' : 'Material purchase created successfully', data: result.data })
})
const updatePurchase = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.updatePurchase(requireTenant(req), req.params.purchaseId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material purchase updated successfully', data })
})
const receivePurchase = catchAsync(async (req: Request, res: Response) => {
  const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
  const result = await SupplierManagementService.receivePurchase(requireTenant(req), req.params.purchaseId, actorId(req), req.body, headerKey)
  sendResponse(res, { statusCode: result.replayed ? httpStatus.OK : httpStatus.CREATED, success: true, message: result.replayed ? 'Material receipt already recorded' : 'Material receipt recorded successfully', data: result })
})
const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
  const result = await SupplierManagementService.recordPurchasePayment(requireTenant(req), req.params.purchaseId, actorId(req), req.body, headerKey)
  sendResponse(res, { statusCode: result.replayed ? httpStatus.OK : httpStatus.CREATED, success: true, message: result.replayed ? 'Supplier payment already recorded' : 'Supplier payment recorded successfully', data: result })
})
const voidPayment = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.voidPurchasePayment(requireTenant(req), req.params.purchaseId, req.params.paymentId, actorId(req), req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Supplier payment voided successfully', data })
})
const cancelPurchase = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.cancelPurchase(requireTenant(req), req.params.purchaseId, actorId(req), req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Material purchase cancelled successfully', data })
})
const latestPrices = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.latestPricesForMaterial(requireTenant(req), req.params.materialId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Latest supplier prices fetched successfully', data })
})
const costSummary = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierManagementService.propertyCostSummary(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Property material cost summary fetched successfully', data })
})
const presignInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierInvoiceAttachmentService.presign(requireTenant(req), req.params.purchaseId, actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Invoice upload prepared successfully', data })
})
const completeInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierInvoiceAttachmentService.complete(requireTenant(req), req.params.purchaseId, req.params.assetId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice attachment uploaded successfully', data })
})
const downloadInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierInvoiceAttachmentService.download(requireTenant(req), req.params.purchaseId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice download prepared successfully', data })
})
const removeInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await SupplierInvoiceAttachmentService.remove(requireTenant(req), req.params.purchaseId)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice attachment removed successfully', data })
})

export const SupplierManagementController = {
  listSuppliers, availableVendors, materialOptions, createSupplier, getSupplier, updateSupplier,
  listPurchases, createPurchase, updatePurchase, receivePurchase, recordPayment, voidPayment, cancelPurchase,
  latestPrices, costSummary, presignInvoice, completeInvoice, downloadInvoice, removeInvoice,
}
