import { SortOrder } from 'mongoose'
import { IPaginationOptions } from '../../interfaces/common'
import config from '../../config'

export type PaginationDefaults = {
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

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

const calculatePagination = (options: IPaginationOptions, defaults: PaginationDefaults = {}): IOptionsResult => {
  const page = Math.min(1_000_000, positiveInt(options.page, 1))
  const requestedLimit = positiveInt(options.limit, 20)
  const limit = Math.min(requestedLimit, config.runtime.max_page_size)
  const skip = (page - 1) * limit

  const requestedSortBy = options.sortBy ?? defaults.sortBy
  const sortBy = typeof requestedSortBy === 'string' && /^[a-zA-Z0-9_.]{1,80}$/.test(requestedSortBy) ? requestedSortBy : 'createdAt'
  const requestedSortOrder = options.sortOrder ?? defaults.sortOrder ?? 'desc'
  const sortOrder: SortOrder = requestedSortOrder === 'asc' ? 1 : -1

  return { page, limit, skip, sortBy, sortOrder }
}

export const buildStableSort = (sortBy: string, sortOrder: SortOrder): Record<string, 1 | -1> => {
  const direction: 1 | -1 = sortOrder === 1 || sortOrder === 'asc' || sortOrder === 'ascending' ? 1 : -1
  return { [sortBy]: direction, _id: direction }
}

export const buildAllowedStableSort = (
  requestedSortBy: string,
  sortOrder: SortOrder,
  allowedFields: ReadonlySet<string>,
  fallbackSortBy = 'createdAt',
): Record<string, 1 | -1> => {
  const sortBy = allowedFields.has(requestedSortBy) ? requestedSortBy : fallbackSortBy
  return buildStableSort(sortBy, sortOrder)
}

export const buildCalendarSort = (): Record<string, 1 | -1> => ({ date: 1, startTime: 1, _id: 1 })

export const paginationHelper = { calculatePagination, buildStableSort, buildAllowedStableSort, buildCalendarSort }
export default paginationHelper
