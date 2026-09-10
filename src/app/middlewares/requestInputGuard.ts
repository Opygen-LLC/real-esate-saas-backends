import { NextFunction, Request, Response } from 'express'
import ApiError from '../../errors/ApiError'
import { assertSafeCommonQuery, assertSafeInputTree, assertSafeRequestHeaders, uploadedFileMetadataSchema } from '../helpers/inputSecurity'

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const requestInputGuard = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    assertSafeRequestHeaders(req.headers as Record<string, unknown>)
    assertSafeInputTree(req.query, { label: 'Query string', maxDepth: 4, maxKeys: 200, maxArrayLength: 100 })
    assertSafeCommonQuery(req.query as Record<string, unknown>)

    if (BODY_METHODS.has(req.method.toUpperCase()) && req.body !== undefined) {
      assertSafeInputTree(req.body, { label: 'Request body', maxDepth: 14, maxKeys: 4_000, maxArrayLength: 2_000 })
    }
    next()
  } catch (error) {
    next(error)
  }
}

export const validateUploadedFiles = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    assertSafeInputTree(req.body, { label: 'Upload metadata', maxDepth: 4, maxKeys: 100, maxArrayLength: 100 })
    const files: Express.Multer.File[] = []
    if (req.file) files.push(req.file)
    if (Array.isArray(req.files)) files.push(...req.files)
    else if (req.files && typeof req.files === 'object') {
      for (const group of Object.values(req.files as Record<string, Express.Multer.File[]>)) files.push(...group)
    }
    if (!files.length) throw new ApiError(400, 'No file uploaded', '', 'UPLOAD_FILE_REQUIRED')
    for (const file of files) uploadedFileMetadataSchema.parse(file)
    next()
  } catch (error) {
    next(error)
  }
}
