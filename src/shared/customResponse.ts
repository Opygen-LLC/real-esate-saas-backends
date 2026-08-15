import { Response } from 'express'

type IApiResponse<T> = {
  statusCode: number
  success: boolean
  message?: string | null
  meta?: {
    page: number
    limit: number
    total: number
  }
  data?: T | null
}

type IApiResponseBody<T> = IApiResponse<T> & { requestId?: string }

export const sendResponse = <T>(res: Response, data: IApiResponse<T>): void => {
  const requestIdHeader = res.getHeader('x-request-id')
  const responseData: IApiResponseBody<T> = {
    statusCode: data.statusCode,
    success: data.success,
    message: data.message ?? null,
    ...(data.meta ? { meta: data.meta } : {}),
    data: data.data ?? null,
    ...(typeof requestIdHeader === 'string' ? { requestId: requestIdHeader } : {}),
  }

  res.status(data.statusCode).json(responseData)
}
