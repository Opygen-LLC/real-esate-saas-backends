class ApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string | undefined, stack = '', code?: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    if (stack) {
      this.stack = stack
    } else {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export default ApiError
