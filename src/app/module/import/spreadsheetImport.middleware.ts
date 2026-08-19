import { Request, RequestHandler } from 'express'
import multer, { FileFilterCallback } from 'multer'
import ApiError from '../../../errors/ApiError'

export const SPREADSHEET_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024

const allowedMimeByExtension: Record<string, Set<string>> = {
  '.csv': new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']),
  '.xlsx': new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/zip']),
}

const extensionOf = (name: string): string => {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export const createSpreadsheetImportUpload = (entityLabel: string): RequestHandler => {
  const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
    const extension = extensionOf(file.originalname || '')
    const allowedMimeTypes = allowedMimeByExtension[extension]
    const mime = String(file.mimetype || '').toLowerCase()

    if (!allowedMimeTypes || !allowedMimeTypes.has(mime)) {
      cb(new Error(`${entityLabel} import accepts CSV (.csv) or Excel (.xlsx) files only`))
      return
    }
    cb(null, true)
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: SPREADSHEET_IMPORT_MAX_FILE_BYTES,
      fields: 4,
      parts: 5,
    },
    fileFilter,
  }).single('file')

  return (req, res, next) => {
    upload(req, res, (error: unknown) => {
      if (!error) return next()
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `${entityLabel} import file must be 5 MB or smaller`))
        return next(new ApiError(400, `Invalid ${entityLabel.toLowerCase()} import upload: ${error.message}`))
      }
      return next(new ApiError(400, error instanceof Error ? error.message : `Invalid ${entityLabel.toLowerCase()} import upload`))
    })
  }
}
