import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

const storage = multer.memoryStorage()
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB limit

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'text/plain',
  ]

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(
      new Error(
        `Invalid file type '${file.mimetype}'. Allowed types: JPEG, PNG, WEBP, GIF, SVG, PDF, TXT.`
      )
    )
  }
}

const multerInstance = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
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
