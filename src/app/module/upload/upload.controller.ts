import { Request, Response } from 'express'
import { StorageService } from './upload.service'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'

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

  const result = await StorageService.uploadFile(file)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'File uploaded successfully to Google Cloud Storage',
    data: result,
  })
})

const uploadMultiple = catchAsync(async (req: Request, res: Response) => {
  const files = extractMultipleFiles(req)
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No files uploaded. Please send files field named 'files' or 'images'.")
  }

  const results = await StorageService.uploadMultipleFiles(files)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: `${results.length} files uploaded successfully to Google Cloud Storage`,
    data: results,
  })
})

const deleteFile = catchAsync(async (req: Request, res: Response) => {
  const { fileName } = req.params
  const targetFileName = Array.isArray(fileName) ? fileName[0] : fileName
  const queryFileName = req.query.fileName as string
  const fileToDelete = targetFileName || queryFileName

  if (!fileToDelete) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Filename parameter is required.')
  }

  await StorageService.deleteFile(fileToDelete)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `File '${fileToDelete}' deleted successfully from Google Cloud Storage`,
    data: null,
  })
})

const getSignedUrl = catchAsync(async (req: Request, res: Response) => {
  const { fileName } = req.params
  const targetFileName = Array.isArray(fileName) ? fileName[0] : fileName
  const queryFileName = req.query.fileName as string
  const fileToSign = targetFileName || queryFileName

  if (!fileToSign) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Filename parameter is required.')
  }

  const expires = parseInt(req.query.expires as string, 10) || 15
  const url = await StorageService.getSignedUrl(fileToSign, expires)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Signed URL generated successfully',
    data: {
      fileName: fileToSign,
      signedUrl: url,
      expiresInMinutes: expires,
    },
  })
})

export const UploadController = {
  uploadSingle,
  uploadMultiple,
  deleteFile,
  getSignedUrl,
}
