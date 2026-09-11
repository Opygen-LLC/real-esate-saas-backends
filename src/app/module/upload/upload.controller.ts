import { Request, Response } from 'express'
import { StorageService, type IUploadResult } from './upload.service'
import catchAsync from '../../../shared/catchAsync'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { DirectUploadService } from './upload.direct.service'

const extractSingleFile = (req: Request): Express.Multer.File | undefined => {
  if (req.file) return req.file
  if (req.files) {
    if (Array.isArray(req.files)) return req.files[0]
    const filesObj = req.files as Record<string, Express.Multer.File[]>
    for (const key of ['file', 'image', 'avatar', 'logo']) {
      if (filesObj[key] && filesObj[key].length > 0) return filesObj[key][0]
    }
  }
  return undefined
}

const extractMultipleFiles = (req: Request): Express.Multer.File[] => {
  if (Array.isArray(req.files)) return req.files
  if (req.files) {
    const filesObj = req.files as Record<string, Express.Multer.File[]>
    const result: Express.Multer.File[] = []
    for (const key of ['files', 'images']) {
      if (filesObj[key]) result.push(...filesObj[key])
    }
    return result
  }
  if (req.file) return [req.file]
  return []
}

const sumTelemetry = (results: IUploadResult[]) => results.reduce((sum, item) => ({
  decodeMs: sum.decodeMs + Number(item.telemetry?.imageDecodeMs || 0),
  resizeMs: sum.resizeMs + Number(item.telemetry?.imageResizeMs || 0),
  encodeMs: sum.encodeMs + Number(item.telemetry?.imageEncodeMs || 0),
  storagePutMs: sum.storagePutMs + Number(item.telemetry?.storagePutMs || 0),
  originalBytes: sum.originalBytes + Number(item.telemetry?.originalBytes || 0),
  finalBytes: sum.finalBytes + Number(item.telemetry?.finalBytes || item.sizeBytes || 0),
}), { decodeMs: 0, resizeMs: 0, encodeMs: 0, storagePutMs: 0, originalBytes: 0, finalBytes: 0 })

const logUploadPerformance = (req: Request, res: Response, results: IUploadResult[]): void => {
  const totals = sumTelemetry(results)
  const locals = res.locals || {}
  const startedAt = Number(locals.uploadStartedAtMs)
  const totalMs = Number.isFinite(startedAt) ? Math.round((performance.now() - startedAt) * 10) / 10 : undefined
  const receiveMs = Number(locals.uploadReceiveMs)
  const folder = String(req.body?.folder || 'general')

  logger.info('upload_performance', {
    event: 'upload_performance',
    organizationId: req.tenant?.organizationId,
    folder,
    fileCount: results.length,
    'upload.request.receive_ms': Number.isFinite(receiveMs) ? receiveMs : undefined,
    'upload.image.decode_ms': Math.round(totals.decodeMs * 10) / 10,
    'upload.image.resize_ms': Math.round(totals.resizeMs * 10) / 10,
    'upload.image.encode_ms': Math.round(totals.encodeMs * 10) / 10,
    'upload.storage.put_ms': Math.round(totals.storagePutMs * 10) / 10,
    'upload.total_ms': totalMs,
    'upload.original_bytes': totals.originalBytes,
    'upload.final_bytes': totals.finalBytes,
  })

  const timingParts = [
    Number.isFinite(receiveMs) ? `upload-receive;dur=${receiveMs}` : '',
    `image-decode;dur=${Math.round(totals.decodeMs * 10) / 10}`,
    `image-resize;dur=${Math.round(totals.resizeMs * 10) / 10}`,
    `image-encode;dur=${Math.round(totals.encodeMs * 10) / 10}`,
    `storage-put;dur=${Math.round(totals.storagePutMs * 10) / 10}`,
    totalMs !== undefined ? `upload-total;dur=${totalMs}` : '',
  ].filter(Boolean)
  if (timingParts.length && typeof res.setHeader === 'function') res.setHeader('Server-Timing', timingParts.join(', '))
}


const directActorId = (req: Request): string => String(req.tenant?.userId || req.user?._id || req.user?.id || '')

const presignDirectUpload = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data = await DirectUploadService.presign(organizationId, directActorId(req), req.body || {})
  res.status(httpStatus.OK).json(data)
})

const completeDirectUpload = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data = await DirectUploadService.complete(organizationId, directActorId(req), req.body || {})
  res.status(httpStatus.ACCEPTED).json(data)
})

const directUploadStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const data = await DirectUploadService.status(organizationId, directActorId(req), String(req.params.uploadId || ''))
  res.status(httpStatus.OK).json(data)
})

const uploadSingle = catchAsync(async (req: Request, res: Response) => {
  const file = extractSingleFile(req)
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No file uploaded. Please send a file field named 'file', 'image', 'avatar', or 'logo'.", '', 'UPLOAD_FILE_REQUIRED')
  }

  const organizationId = requireTenant(req)
  await EntitlementService.assertStorage(organizationId, file.size)
  const result = await StorageService.uploadFile(organizationId, file)
  await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: result.sizeBytes } })
  logUploadPerformance(req, res, [result])

  res.status(httpStatus.CREATED).json({
    publicUrl: result.publicUrl,
  })
})

const uploadMultiple = catchAsync(async (req: Request, res: Response) => {
  const files = extractMultipleFiles(req)
  if (!files.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No files uploaded. Please send files using the 'files' or 'images' field.", '', 'UPLOAD_FILE_REQUIRED')
  }

  const organizationId = requireTenant(req)
  await EntitlementService.assertStorage(organizationId, files.reduce((sum, file) => sum + Number(file.size || 0), 0))
  const results = await StorageService.uploadMultipleFiles(organizationId, files)
  await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: results.reduce((sum, item) => sum + item.sizeBytes, 0) } })
  logUploadPerformance(req, res, results)

  res.status(httpStatus.CREATED).json({
    publicUrls: results.map((item) => item.publicUrl),
  })
})

export const UploadController = {
  presignDirectUpload,
  completeDirectUpload,
  directUploadStatus,
  uploadSingle,
  uploadMultiple,
}
