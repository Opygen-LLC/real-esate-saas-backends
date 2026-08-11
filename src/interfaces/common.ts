export type IGenericErrorMessage = {
  path: string | number
  message: string
}

export type IGenericErrorResponse = {
  statusCode: number
  message: string
  errorMessages: IGenericErrorMessage[]
  stack?: string
}

export type IPaginationOptions = {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type IGenericResponse<T> = {
  meta: {
    page: number
    limit: number
    total: number
  }
  data: T
}

export type IAuthUser = {
  _id: string
  phoneNumber: string
  email: string
  userRole: string
  organizationId: string
}
