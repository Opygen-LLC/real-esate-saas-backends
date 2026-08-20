export type IGenericErrorMessage = {
  path: string | number
  message: string
}

export type IGenericErrorResponse = {
  statusCode: number
  message: string
  errorMessages: IGenericErrorMessage[]
  code?: string
  fieldErrors?: Record<string, string[]>
  requestId?: string
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
    totalPages?: number
    summary?: Record<string, number>
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
