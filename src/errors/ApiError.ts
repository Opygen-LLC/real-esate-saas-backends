class ApiError extends Error {
  statusCode: number
  code?: string
  details?: Record<string, unknown>
  fieldErrors?: Record<string, string[]>

  constructor(statusCode: number, message: string | undefined, stack = '', code?: string, details?: Record<string, unknown>, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.fieldErrors = fieldErrors
    if (stack) {
      this.stack = stack
    } else {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export default ApiError
