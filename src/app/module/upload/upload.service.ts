import { bucket, storageConfig } from './upload.config'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'

export interface IUploadResult {
  publicUrl: string
  sizeBytes: number
}

const compressImage = async (buffer: Buffer, mimetype: string): Promise<Buffer> => {
  try {
    const normalizedType = mimetype.toLowerCase()
    if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
      return await sharp(buffer)
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer()
    } else if (normalizedType === 'image/png') {
      return await sharp(buffer)
        .png({ quality: 80, compressionLevel: 8 })
        .toBuffer()
    }
    return buffer
  } catch (_err) {
    // If sharp fails to parse format, fallback to original buffer safely
    return buffer
  }
}

const uploadFile = async (file: Express.Multer.File): Promise<IUploadResult> => {
  if (!file || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file buffer available for upload')
  }

  const compressedBuffer = await compressImage(file.buffer, file.mimetype)

  const sanitizedOriginalName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_') : 'image.jpg'
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
      resolve({ publicUrl, sizeBytes: compressedBuffer.length })
    })

    blobStream.end(compressedBuffer)
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
