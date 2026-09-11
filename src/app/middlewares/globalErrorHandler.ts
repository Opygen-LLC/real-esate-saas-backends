/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import multer from 'multer'
import { API_ERROR_CODES, buildFieldErrors, defaultErrorCodeForStatus } from '../../contracts/apiContract'
import ApiError from '../../errors/ApiError'
import handleCastError from '../../errors/handleCastError'
import handleValidationError from '../../errors/handleValidationError'
import handleZodError from '../../errors/handleZodError'
import { IGenericErrorMessage } from '../../interfaces/common'
import { errorLogger } from '../../shared/logger'
import { httpErrorEvent, httpLogLevelForStatus, isUnexpectedServerError, requestRoute } from '../../shared/httpObservability'
import { classifyInvoiceFailure } from '../../shared/invoiceFailureTelemetry'
import { emitProductionEvent } from '../../shared/productionEvents'
import { recordSecurityRejection } from '../../shared/securityObservability'

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
  } else if (error instanceof multer.MulterError) {
    // Defense in depth: upload-specific middleware should normally translate
    // Multer errors first, but no Multer validation failure may surface as 500.
    statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    const mapped = error.code === 'LIMIT_FILE_SIZE'
      ? { code: API_ERROR_CODES.FILE_TOO_LARGE, message: 'Uploaded file is too large.' }
      : error.code === 'LIMIT_FILE_COUNT'
        ? { code: API_ERROR_CODES.TOO_MANY_FILES, message: 'Too many files were uploaded.' }
        : error.code === 'LIMIT_FIELD_COUNT'
          ? { code: API_ERROR_CODES.TOO_MANY_FIELDS, message: 'Too many upload metadata fields were sent.' }
          : error.code === 'LIMIT_PART_COUNT'
            ? { code: API_ERROR_CODES.TOO_MANY_PARTS, message: 'Too many multipart upload parts were sent.' }
            : error.code === 'LIMIT_UNEXPECTED_FILE'
              ? { code: API_ERROR_CODES.INVALID_UPLOAD_FIELD, message: 'Unexpected upload field.' }
              : { code: API_ERROR_CODES.BAD_REQUEST, message: 'Invalid multipart upload.' }
    code = mapped.code
    message = mapped.message
    errorMessages = [{ path: '', message }]
  } else if (error instanceof Error) {
    // Unknown errors are never reflected to clients. Full details stay in the
    // structured server logs, which avoids stack/message leakage even when a
    // deployment accidentally misconfigures NODE_ENV.
    message = 'Internal server error'
    errorMessages = []
  }

  const expectedPublicWebsiteLock = code === API_ERROR_CODES.PUBLIC_WEBSITE_UNAVAILABLE
  const event = expectedPublicWebsiteLock ? 'request_rejected' : httpErrorEvent(statusCode)
  const level = expectedPublicWebsiteLock ? 'info' : httpLogLevelForStatus(statusCode, code)
  const route = requestRoute(req)
  recordSecurityRejection({ req, statusCode, errorCode: code })

  const commonLogMeta = {
    event,
    requestId: req.requestId,
    method: req.method,
    route,
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
      route,
      organizationId: req.tenant?.organizationId,
      fields: Object.keys(fieldErrors).slice(0, 50),
      fieldCount: Object.keys(fieldErrors).length,
      requestId: req.requestId,
    })
  }

  if (route.includes('/finance') && statusCode >= 400) {
    emitProductionEvent('finance_request_failed', {
      method: req.method,
      route,
      statusCode,
      errorCode: code,
      organizationId: req.tenant?.organizationId,
      requestId: req.requestId,
    }, statusCode >= 500 ? 'error' : 'warn')
  }

  const invoiceWriteFailure = route.includes('/finance/invoices')
    && ['POST', 'PUT', 'PATCH'].includes(req.method)
    && statusCode >= 400
  if (invoiceWriteFailure) {
    emitProductionEvent('invoice_request_failed', {
      method: req.method,
      route,
      statusCode,
      errorCode: code,
      failureClass: classifyInvoiceFailure(statusCode, code),
      organizationId: req.tenant?.organizationId,
      requestId: req.requestId,
      fields: code === API_ERROR_CODES.VALIDATION_ERROR ? Object.keys(fieldErrors).slice(0, 50) : undefined,
    }, statusCode >= 500 ? 'error' : 'warn')
  }


  if (route.includes('/website/studio/publish') && statusCode >= 400) {
    emitProductionEvent('website_publish_failed', {
      method: req.method,
      route,
      statusCode,
      errorCode: code,
      organizationId: req.tenant?.organizationId,
      requestId: req.requestId,
    }, statusCode >= 500 ? 'error' : 'warn')
  }

  const publicFormRoute = route.includes('/viewing/public-request') || route.includes('/lead/public-capture')
  if (publicFormRoute && statusCode >= 400) {
    emitProductionEvent('public_form_failed', {
      method: req.method,
      route,
      statusCode,
      errorCode: code,
      organizationId: req.tenant?.organizationId,
      requestId: req.requestId,
    }, statusCode >= 500 ? 'error' : 'warn')
  }

  if (req.method === 'GET' && route.includes('/property/public') && statusCode >= 400) {
    emitProductionEvent('public_property_query_failed', {
      method: req.method,
      route,
      statusCode,
      errorCode: code,
      organizationId: req.tenant?.organizationId,
      requestId: req.requestId,
    }, statusCode >= 500 ? 'error' : 'warn')
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
  })
}

export default globalErrorHandler
