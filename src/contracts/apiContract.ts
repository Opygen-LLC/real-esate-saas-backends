export const API_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES] | string

export type ApiFieldErrors = Record<string, string[]>

export type ApiErrorItem = {
  path: string
  message: string
}

export type ApiErrorResponse = {
  success: false
  code: ApiErrorCode
  message: string
  fieldErrors: ApiFieldErrors
  errorMessages: ApiErrorItem[]
  details?: Record<string, unknown>
  requestId?: string
  stack?: string
}

export const normalizeErrorPath = (value: string | number | undefined): string => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

export const buildFieldErrors = (items: Array<{ path: string | number; message: string }>): ApiFieldErrors => {
  const fieldErrors: ApiFieldErrors = {}
  for (const item of items) {
    const path = normalizeErrorPath(item.path)
    if (!path) continue
    fieldErrors[path] ||= []
    if (!fieldErrors[path].includes(item.message)) fieldErrors[path].push(item.message)
  }
  return fieldErrors
}

export const defaultErrorCodeForStatus = (statusCode: number): ApiErrorCode => {
  if (statusCode === 400 || statusCode === 422) return API_ERROR_CODES.BAD_REQUEST
  if (statusCode === 401) return API_ERROR_CODES.UNAUTHORIZED
  if (statusCode === 403) return API_ERROR_CODES.FORBIDDEN
  if (statusCode === 404) return API_ERROR_CODES.NOT_FOUND
  if (statusCode === 409) return API_ERROR_CODES.CONFLICT
  if (statusCode === 429) return API_ERROR_CODES.RATE_LIMITED
  if (statusCode >= 500) return API_ERROR_CODES.INTERNAL_ERROR
  return API_ERROR_CODES.BAD_REQUEST
}
