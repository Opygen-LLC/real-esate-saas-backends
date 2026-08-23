import { bucket, storageConfig } from './upload.config'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'

export interface IUploadResult {
  publicUrl: string
  sizeBytes: number
}

// Max dimension: 1920px on longest side. Prevents 4K+ originals ballooning egress.
const MAX_DIMENSION = 1920

const sanitizeImage = async (buffer: Buffer, mimetype: string): Promise<{ buffer: Buffer; contentType: string; extension: string }> => {
  const normalizedType = mimetype.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimetype.toLowerCase()
  try {
    const image = sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })

    if (normalizedType === 'image/jpeg') return { buffer: await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: 'image/jpeg', extension: 'jpg' }
    if (normalizedType === 'image/png') return { buffer: await image.png({ compressionLevel: 8 }).toBuffer(), contentType: 'image/png', extension: 'png' }
    if (normalizedType === 'image/webp') return { buffer: await image.webp({ quality: 82 }).toBuffer(), contentType: 'image/webp', extension: 'webp' }
    if (normalizedType === 'image/avif') return { buffer: await image.avif({ quality: 72 }).toBuffer(), contentType: 'image/avif', extension: 'avif' }
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported image format')
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(httpStatus.BAD_REQUEST, 'The uploaded file is not a valid image')
  }
}

const uploadFile = async (file: Express.Multer.File): Promise<IUploadResult> => {
  if (!file || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file buffer available for upload')
  }

  const sanitized = await sanitizeImage(file.buffer, file.mimetype)

  const originalStem = (file.originalname || 'image').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'image'
  const uniqueFileName = `uploads/${Date.now()}-${randomBytes(4).toString('hex')}-${originalStem}.${sanitized.extension}`
  const blob = bucket.file(uniqueFileName)

  return new Promise((resolve, reject) => {
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: sanitized.contentType,
      metadata: {
        contentType: sanitized.contentType,
        // Cache images for 1 year in browsers and CDN (immutable filename via timestamp+random)
        cacheControl: 'public, max-age=31536000',
      },
    })

    blobStream.on('error', (err) => {
      reject(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `GCS Upload Error: ${err.message}`))
    })

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${storageConfig.bucketName}/${blob.name}`
      resolve({ publicUrl, sizeBytes: sanitized.buffer.length })
    })

    blobStream.end(sanitized.buffer)
  })
}

const uploadMultipleFiles = async (files: Express.Multer.File[]): Promise<IUploadResult[]> => {
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No files provided for upload')
  }
  const uploadPromises = files.map((file) => uploadFile(file))
  return Promise.all(uploadPromises)
}

export const StorageService = {
  uploadFile,
  uploadMultipleFiles,
}
