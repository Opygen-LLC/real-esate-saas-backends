import { ZodError, ZodIssue } from 'zod'
import { API_ERROR_CODES, buildFieldErrors } from '../contracts/apiContract'
import { IGenericErrorMessage, IGenericErrorResponse } from '../interfaces/common'

const readablePath = (path: Array<string | number>): string => {
  const parts = path.map(String)
  if (['body', 'query', 'params', 'cookies'].includes(parts[0])) parts.shift()
  return parts.join('.')
}

const messagesForIssue = (issue: ZodIssue): IGenericErrorMessage[] => {
  const path = readablePath(issue.path)
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: [path, key].filter(Boolean).join('.'),
      message: 'This field is not allowed in this request',
    }))
  }
  return [{ path, message: issue.message }]
}

const handleZodError = (error: ZodError): IGenericErrorResponse => {
  const errorMessages = error.issues.flatMap(messagesForIssue)
  return {
    statusCode: 400,
    code: API_ERROR_CODES.VALIDATION_ERROR,
    message: 'Please correct the highlighted fields',
    errorMessages,
    fieldErrors: buildFieldErrors(errorMessages),
  }
}

export default handleZodError
