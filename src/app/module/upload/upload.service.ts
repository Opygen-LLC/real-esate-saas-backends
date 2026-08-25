import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'

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

const uploadFile = async (organizationId: string, file: Express.Multer.File): Promise<IUploadResult> => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  if (!file || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file buffer available for upload')
  }

  const sanitized = await sanitizeImage(file.buffer, file.mimetype)

  const tenantId = String(organizationId || '').trim()
  if (!tenantId) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization id is required for uploads')
  const originalStem = (file.originalname || 'image').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'image'
  const objectKey = `tenants/${tenantId}/uploads/${Date.now()}-${randomBytes(4).toString('hex')}-${originalStem}.${sanitized.extension}`
  await ObjectStorageService.putBuffer(objectKey, sanitized.buffer, sanitized.contentType)
  return {
    publicUrl: ObjectStorageService.publicUrl(objectKey),
    sizeBytes: sanitized.buffer.length,
  }
}

const uploadMultipleFiles = async (organizationId: string, files: Express.Multer.File[]): Promise<IUploadResult[]> => {
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No files provided for upload')
  }
  const uploadPromises = files.map((file) => uploadFile(organizationId, file))
  return Promise.all(uploadPromises)
}

export const StorageService = {
  uploadFile,
  uploadMultipleFiles,
}
