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
import { httpErrorEvent, httpLogLevelForStatus, isUnexpectedServerError, requestRoute } from '../../shared/httpObservability'
import { emitProductionEvent } from '../../shared/productionEvents'

const globalErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
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

  const expectedPublicWebsiteLock = code === API_ERROR_CODES.PUBLIC_WEBSITE_UNAVAILABLE
  const event = expectedPublicWebsiteLock ? 'request_rejected' : httpErrorEvent(statusCode)
  const level = expectedPublicWebsiteLock ? 'info' : httpLogLevelForStatus(statusCode, code)
  const commonLogMeta = {
    event,
    requestId: req.requestId,
    method: req.method,
    route: requestRoute(req),
    statusCode,
    organizationId: req.tenant?.organizationId,
    errorCode: code,
    errorName: error?.name || 'Error',
    durationMs: typeof res.locals.requestStartedAtMs === 'number'
      ? Math.round((performance.now() - res.locals.requestStartedAtMs) * 10) / 10
      : undefined,
  }

  // Expected access rejections (including the intentional public-site 503) are operational responses, not application crashes.
  // Keep them concise so expired sessions/subscriptions cannot flood production
  // with stack traces. Unexpected 5xx errors retain the original Error object so
  // source-mapped stacks remain available in Cloud Logging.
  if (isUnexpectedServerError(statusCode) && !expectedPublicWebsiteLock) {
    errorLogger.log(level, event, { ...commonLogMeta, error })
  } else {
    errorLogger.log(level, event, { ...commonLogMeta, errorMessage: message })
  }

  if (code === API_ERROR_CODES.VALIDATION_ERROR) {
    emitProductionEvent('form_validation_failed', {
      method: req.method,
      route: requestRoute(req),
      organizationId: req.tenant?.organizationId,
      fields: Object.keys(fieldErrors).slice(0, 50),
      fieldCount: Object.keys(fieldErrors).length,
      requestId: req.requestId,
    })
  }

  res.locals.apiErrorCode = code
  res.locals.apiErrorEvent = event

  if (code === API_ERROR_CODES.PUBLIC_WEBSITE_UNAVAILABLE || code === API_ERROR_CODES.PUBLIC_WEBSITE_NOT_PUBLISHED || code === 'TENANT_SUSPENDED') {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
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
