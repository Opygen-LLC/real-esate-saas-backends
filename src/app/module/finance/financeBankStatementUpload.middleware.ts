import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase()
    const allowed = name.endsWith('.csv') || name.endsWith('.xlsx') || file.mimetype.includes('csv') || file.mimetype.includes('spreadsheet')
    callback(allowed ? null : new Error('Only CSV and XLSX bank statements are supported'), allowed)
  },
}).single('file')

export const financeBankStatementUpload = (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, (error: unknown) => {
    if (error) return next(new ApiError(httpStatus.BAD_REQUEST, error instanceof Error ? error.message : 'Invalid bank statement upload'))
    if (!req.file) return next(new ApiError(httpStatus.BAD_REQUEST, 'Bank statement file is required'))
    return next()
  })
}
