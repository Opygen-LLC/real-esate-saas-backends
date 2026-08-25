import { Request, Response } from 'express'
import { StorageService } from './upload.service'
import catchAsync from '../../../shared/catchAsync'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'

const extractSingleFile = (req: Request): Express.Multer.File | undefined => {
  if (req.file) return req.file
  if (req.files) {
    if (Array.isArray(req.files)) {
      return req.files[0]
    }
    const filesObj = req.files as Record<string, Express.Multer.File[]>
    for (const key of ['file', 'image', 'avatar', 'logo']) {
      if (filesObj[key] && filesObj[key].length > 0) {
        return filesObj[key][0]
      }
    }
    const firstKey = Object.keys(filesObj)[0]
    if (firstKey && filesObj[firstKey].length > 0) {
      return filesObj[firstKey][0]
    }
  }
  return undefined
}

const extractMultipleFiles = (req: Request): Express.Multer.File[] => {
  if (Array.isArray(req.files)) return req.files
  if (req.files) {
    const filesObj = req.files as Record<string, Express.Multer.File[]>
    const result: Express.Multer.File[] = []
    for (const key of ['files', 'images', 'file', 'image']) {
      if (filesObj[key]) {
        result.push(...filesObj[key])
      }
    }
    if (result.length > 0) return result
    for (const key of Object.keys(filesObj)) {
      result.push(...filesObj[key])
    }
    return result
  }
  if (req.file) return [req.file]
  return []
}

const uploadSingle = catchAsync(async (req: Request, res: Response) => {
  const file = extractSingleFile(req)
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No file uploaded. Please send a file field named 'file' or 'image'.")
  }

  const organizationId = requireTenant(req)
  await EntitlementService.assertStorage(organizationId, file.size)
  const result = await StorageService.uploadFile(organizationId, file)
  await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: result.sizeBytes } })

  res.status(httpStatus.CREATED).json({
    publicUrl: result.publicUrl,
  })
})

const uploadMultiple = catchAsync(async (req: Request, res: Response) => {
  const files = extractMultipleFiles(req)
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No files uploaded. Please send files field named 'files' or 'images'.")
  }

  const organizationId = requireTenant(req)
  await EntitlementService.assertStorage(organizationId, files.reduce((sum, file) => sum + Number(file.size || 0), 0))
  const results = await StorageService.uploadMultipleFiles(organizationId, files)
  await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: results.reduce((sum, item) => sum + item.sizeBytes, 0) } })

  res.status(httpStatus.CREATED).json({
    publicUrls: results.map((item) => item.publicUrl),
  })
})

export const UploadController = {
  uploadSingle,
  uploadMultiple,
}
