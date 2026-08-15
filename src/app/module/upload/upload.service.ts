import { bucket, storageConfig } from './upload.config'
import { randomBytes } from 'crypto'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'

export interface IUploadResult {
  fileName: string
  originalName: string
  publicUrl: string
  url: string
  size: number
  mimetype: string
}

const uploadFile = async (file: Express.Multer.File): Promise<IUploadResult> => {
  if (!file || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file buffer available for upload')
  }

  const sanitizedOriginalName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file'
  const uniqueFileName = `uploads/${Date.now()}-${randomBytes(4).toString('hex')}-${sanitizedOriginalName}`
  const blob = bucket.file(uniqueFileName)

  return new Promise((resolve, reject) => {
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
      metadata: {
        contentType: file.mimetype,
      },
    })

    blobStream.on('error', (err) => {
      reject(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `GCS Upload Error: ${err.message}`))
    })

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${storageConfig.bucketName}/${blob.name}`
      resolve({
        fileName: blob.name,
        originalName: file.originalname,
        publicUrl,
        url: publicUrl,
        size: file.size,
        mimetype: file.mimetype,
      })
    })

    blobStream.end(file.buffer)
  })
}

const uploadMultipleFiles = async (files: Express.Multer.File[]): Promise<IUploadResult[]> => {
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No files provided for upload')
  }
  const uploadPromises = files.map((file) => uploadFile(file))
  return Promise.all(uploadPromises)
}

const deleteFile = async (fileName: string): Promise<boolean> => {
  if (!fileName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Filename parameter is required')
  }
  const targetFileName = fileName.startsWith('http')
    ? fileName.replace(`https://storage.googleapis.com/${storageConfig.bucketName}/`, '')
    : fileName

  const file = bucket.file(targetFileName)
  const [exists] = await file.exists()
  if (!exists) {
    throw new ApiError(httpStatus.NOT_FOUND, `File '${targetFileName}' not found in storage`)
  }

  await file.delete()
  return true
}

const getSignedUrl = async (fileName: string, expiresMinutes = 15): Promise<string> => {
  if (!fileName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Filename parameter is required')
  }
  const targetFileName = fileName.startsWith('http')
    ? fileName.replace(`https://storage.googleapis.com/${storageConfig.bucketName}/`, '')
    : fileName

  const file = bucket.file(targetFileName)
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresMinutes * 60 * 1000,
  })
  return url
}

export const StorageService = {
  uploadFile,
  uploadMultipleFiles,
  deleteFile,
  getSignedUrl,
}
