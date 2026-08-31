import { IPaginationOptions } from '../../interfaces/common'
import ApiError from '../../errors/ApiError'
import paginationHelper from './paginationHelper'
import { buildKeysetRange, decodeKeysetCursor, encodeKeysetCursor, KeysetCursor } from './keysetPagination'

type CursorPrimitive = string | number | Date

type CursorOptions = {
  sortField: string
  sortOrder: 'asc' | 'desc'
  parseValue?: (value: KeysetCursor['value']) => unknown
}

export const prepareCursorPagination = (pagination: IPaginationOptions, options: CursorOptions) => {
  const calculated = paginationHelper.calculatePagination({
    ...pagination,
    sortBy: options.sortField,
    sortOrder: options.sortOrder,
  })
  const cursorMode = Boolean(pagination.cursor)
  const decoded = pagination.cursor && pagination.cursor !== 'start' ? decodeKeysetCursor(pagination.cursor) : undefined
  return {
    ...calculated,
    cursorMode,
    range: decoded
      ? buildKeysetRange(options.sortField, options.sortOrder, decoded, options.parseValue)
      : undefined,
    queryLimit: cursorMode ? calculated.limit + 1 : calculated.limit,
    querySkip: cursorMode ? 0 : calculated.skip,
  }
}

export const finalizeCursorPage = <T extends Record<string, any>>(
  rows: T[],
  limit: number,
  sortField: string,
  cursorRequested: boolean,
) => {
  if (!cursorRequested) return { rows, nextCursor: undefined, hasMore: false }
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]
  if (!hasMore || !last) return { rows: pageRows, nextCursor: undefined, hasMore: false }
  const value = last[sortField] as CursorPrimitive | undefined
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    throw new ApiError(500, `Cursor sort field ${sortField} is unavailable on the result row`)
  }
  return {
    rows: pageRows,
    nextCursor: encodeKeysetCursor(value, last._id),
    hasMore: true,
  }
}

export const parseDateCursorValue = (value: KeysetCursor['value']) => {
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, 'Invalid date pagination cursor')
  return parsed
}
