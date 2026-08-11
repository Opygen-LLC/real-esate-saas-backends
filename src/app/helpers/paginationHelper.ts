import { SortOrder } from 'mongoose'
import { IPaginationOptions } from '../../interfaces/common'

type IOptionsResult = {
  page: number
  limit: number
  skip: number
  sortBy: string
  sortOrder: SortOrder
}

const calculatePagination = (options: IPaginationOptions): IOptionsResult => {
  const page = Number(options.page || 1)
  const limit = Number(options.limit || 10)
  const skip = (page - 1) * limit

  const sortBy = options.sortBy || 'createdAt'
  const sortOrder: SortOrder = options.sortOrder === 'asc' ? 1 : -1

  return {
    page,
    limit,
    skip,
    sortBy,
    sortOrder,
  }
}

export const paginationHelper = {
  calculatePagination,
}

export default paginationHelper
