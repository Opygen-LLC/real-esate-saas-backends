import mongoose from 'mongoose'
import { API_ERROR_CODES, buildFieldErrors } from '../contracts/apiContract'
import { IGenericErrorMessage, IGenericErrorResponse } from '../interfaces/common'

const handleValidationError = (
  error: mongoose.Error.ValidationError,
): IGenericErrorResponse => {
  const errorMessages: IGenericErrorMessage[] = Object.values(error.errors).map(
    (item: mongoose.Error.ValidatorError | mongoose.Error.CastError) => ({
      path: item.path,
      message: item.message,
    }),
  )

  return {
    statusCode: 400,
    code: API_ERROR_CODES.VALIDATION_ERROR,
    message: 'Please correct the highlighted fields',
    errorMessages,
    fieldErrors: buildFieldErrors(errorMessages),
  }
}

export default handleValidationError
