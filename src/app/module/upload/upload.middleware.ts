import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'
import path from 'path'

const storage = multer.memoryStorage()
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB limit

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png'])
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png'])
  const originalName = String(file.originalname || '').replace(/\0/g, '').trim()
  const cleanName = path.posix.basename(path.win32.basename(originalName))
  const extension = path.extname(cleanName).toLowerCase()

  if (cleanName && cleanName.length <= 255 && allowedMimeTypes.has(file.mimetype.toLowerCase()) && allowedExtensions.has(extension)) {
    file.originalname = cleanName
    cb(null, true)
  } else {
    cb(
      new Error(
        `Invalid file type '${file.mimetype}'. Only JPEG, JPG, and PNG images are allowed.`
      )
    )
  }
}

const multerInstance = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10,
    fields: 0,
    parts: 10,
    fieldNameSize: 80,
  },
  fileFilter,
})

export const uploadSingle = multerInstance.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
])

export const uploadMultiple = multerInstance.fields([
  { name: 'files', maxCount: 10 },
  { name: 'images', maxCount: 10 },
])
