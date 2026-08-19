import express, { Request, RequestHandler } from 'express'
import multer from 'multer'
import path from 'node:path'
import { Readable } from 'node:stream'
import ApiError from '../../../errors/ApiError'

export const SPREADSHEET_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx'])
const RAW_UPLOAD_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
])

const extensionOf = (name: string): string => path.extname(String(name || '')).toLowerCase()

const assertSupportedFileName = (name: string, entityLabel: string): string => {
  const cleaned = String(name || '').replace(/\0/g, '').trim()
  const safeName = path.posix.basename(path.win32.basename(cleaned))
  if (!safeName || !SUPPORTED_EXTENSIONS.has(extensionOf(safeName))) {
    throw new ApiError(400, `${entityLabel} import accepts CSV (.csv) or Excel (.xlsx) files only`)
  }
  return safeName.slice(0, 255)
}

const decodeMaybeUriComponent = (value: string): string => {
  try { return decodeURIComponent(value) } catch { return value }
}

const decodeRawFileName = (req: Request): string => {
  const customName = String(req.headers['x-import-file-name'] || '').trim()
  if (customName) return decodeMaybeUriComponent(customName)

  const disposition = String(req.headers['content-disposition'] || '')
  const encodedName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  if (encodedName) return decodeMaybeUriComponent(encodedName.trim().replace(/^"|"$/g, ''))
  const plainName = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]
  if (plainName) return plainName.trim()

  const extension = String(req.headers['x-import-file-extension'] || '').trim().toLowerCase()
  return SUPPORTED_EXTENSIONS.has(extension) ? `import${extension}` : ''
}

const normalizeContentType = (value: unknown): string => String(value || '').split(';', 1)[0].trim().toLowerCase()

export const createSpreadsheetImportUpload = (entityLabel: string): RequestHandler => {
  // Multipart remains supported for Postman, legacy dashboards and API clients.
  // Do not trust browser/OS MIME labels here. The extension selects the parser and
  // the parser validates the actual CSV/XLSX structure before any data is accepted.
  const multipartUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: SPREADSHEET_IMPORT_MAX_FILE_BYTES,
      fields: 4,
      parts: 5,
    },
    fileFilter: (_req, file, cb) => {
      try {
        assertSupportedFileName(file.originalname, entityLabel)
        cb(null, true)
      } catch (error) {
        cb(error instanceof Error ? error : new Error(`Invalid ${entityLabel.toLowerCase()} import upload`))
      }
    },
  }).single('file')

  // The dashboard uses a raw binary upload. This avoids multipart boundary/MIME
  // rewriting issues through reverse proxies while preserving the exact workbook.
  const rawUpload = express.raw({
    type: () => true,
    limit: SPREADSHEET_IMPORT_MAX_FILE_BYTES,
  })

  return (req, res, next) => {
    const contentType = normalizeContentType(req.headers['content-type'])

    if (contentType === 'multipart/form-data') {
      multipartUpload(req, res, (error: unknown) => {
        if (!error) return next()
        if (error instanceof multer.MulterError) {
          if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `${entityLabel} import file must be 5 MB or smaller`))
          return next(new ApiError(400, `Invalid ${entityLabel.toLowerCase()} import upload: ${error.message}`))
        }
        return next(error instanceof ApiError
          ? error
          : new ApiError(400, error instanceof Error ? error.message : `Invalid ${entityLabel.toLowerCase()} import upload`))
      })
      return
    }

    if (!RAW_UPLOAD_CONTENT_TYPES.has(contentType)) {
      return next(new ApiError(400, `${entityLabel} import upload must be a CSV/XLSX file sent as multipart/form-data or raw binary`))
    }

    rawUpload(req, res, (error: unknown) => {
      if (error) {
        const code = (error as { type?: string; status?: number })?.type
        if (code === 'entity.too.large' || (error as { status?: number })?.status === 413) {
          return next(new ApiError(413, `${entityLabel} import file must be 5 MB or smaller`))
        }
        return next(new ApiError(400, `Invalid ${entityLabel.toLowerCase()} import upload`))
      }

      try {
        const originalname = assertSupportedFileName(decodeRawFileName(req), entityLabel)
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new ApiError(400, `Choose a CSV or XLSX file to import`)
        }

        req.file = {
          fieldname: 'file',
          originalname,
          encoding: '7bit',
          mimetype: String(req.headers['x-import-file-type'] || contentType || 'application/octet-stream'),
          size: req.body.length,
          buffer: req.body,
          destination: '',
          filename: originalname,
          path: '',
          stream: Readable.from(req.body),
        }
        next()
      } catch (uploadError) {
        next(uploadError instanceof ApiError
          ? uploadError
          : new ApiError(400, uploadError instanceof Error ? uploadError.message : `Invalid ${entityLabel.toLowerCase()} import upload`))
      }
    })
  }
}
