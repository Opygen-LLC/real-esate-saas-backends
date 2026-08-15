/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import config from '../../config'
import { API_ERROR_CODES, buildFieldErrors, defaultErrorCodeForStatus } from '../../contracts/apiContract'
import ApiError from '../../errors/ApiError'
import handleCastError from '../../errors/handleCastError'
import handleValidationError from '../../errors/handleValidationError'
import handleZodError from '../../errors/handleZodError'
import { IGenericErrorMessage } from '../../interfaces/common'
import { errorLogger } from '../../shared/logger'

const globalErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  errorLogger.error('Unhandled request error', {
    error,
    method: req.method,
    path: req.path,
    statusCode: error?.statusCode || 500,
    requestId: req.requestId,
  })

  let statusCode = 500
  let message = 'Internal server error'
  let code: string = API_ERROR_CODES.INTERNAL_ERROR
  let errorMessages: IGenericErrorMessage[] = []
  let fieldErrors: Record<string, string[]> = {}
  let details: Record<string, unknown> | undefined

  if (error?.name === 'ValidationError') {
    const simplifiedError = handleValidationError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.message
    code = simplifiedError.code || API_ERROR_CODES.VALIDATION_ERROR
    errorMessages = simplifiedError.errorMessages
    fieldErrors = simplifiedError.fieldErrors || buildFieldErrors(errorMessages)
  } else if (error instanceof ZodError) {
    const simplifiedError = handleZodError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.message
    code = simplifiedError.code || API_ERROR_CODES.VALIDATION_ERROR
    errorMessages = simplifiedError.errorMessages
    fieldErrors = simplifiedError.fieldErrors || buildFieldErrors(errorMessages)
  } else if (error?.name === 'CastError') {
    const simplifiedError = handleCastError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.message
    code = API_ERROR_CODES.VALIDATION_ERROR
    errorMessages = simplifiedError.errorMessages
    fieldErrors = buildFieldErrors(errorMessages)
  } else if (error instanceof ApiError) {
    statusCode = error.statusCode
    message = error.message
    code = error.code || defaultErrorCodeForStatus(statusCode)
    details = error.details
    fieldErrors = error.fieldErrors || {}
    errorMessages = error.message ? [{ path: '', message: error.message }] : []
  } else if (error instanceof Error) {
    message = config.env === 'production' ? 'Internal server error' : error.message
    errorMessages = config.env === 'production' ? [] : [{ path: '', message: error.message }]
  }

  res.status(statusCode).json({
    success: false,
    code,
    message,
    fieldErrors,
    errorMessages,
    details,
    requestId: req.requestId,
    stack: config.env !== 'production' ? error?.stack : undefined,
  })
}

export default globalErrorHandler
