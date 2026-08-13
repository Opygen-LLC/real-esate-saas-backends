import { SortOrder } from 'mongoose'
import { IPaginationOptions } from '../../interfaces/common'
import config from '../../config'

type IOptionsResult = {
  page: number
  limit: number
  skip: number
  sortBy: string
  sortOrder: SortOrder
}

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const calculatePagination = (options: IPaginationOptions): IOptionsResult => {
  const page = Math.min(1_000_000, positiveInt(options.page, 1))
  const requestedLimit = positiveInt(options.limit, 20)
  const limit = Math.min(requestedLimit, config.runtime.max_page_size)
  const skip = (page - 1) * limit

  const sortBy = typeof options.sortBy === 'string' && /^[a-zA-Z0-9_.]{1,80}$/.test(options.sortBy) ? options.sortBy : 'createdAt'
  const sortOrder: SortOrder = options.sortOrder === 'asc' ? 1 : -1

  return { page, limit, skip, sortBy, sortOrder }
}

export const paginationHelper = { calculatePagination }
export default paginationHelper
