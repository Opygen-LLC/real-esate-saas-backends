import { Types } from 'mongoose'
import ApiError from '../../errors/ApiError'

export type KeysetCursorValue = string | number | Date
export type KeysetCursor = { value: string | number; id: string }

const encodeValue = (value: KeysetCursorValue) => value instanceof Date ? value.toISOString() : value

export const encodeKeysetCursor = (value: KeysetCursorValue, id: unknown): string => {
  const objectId = String(id || '')
  if (!Types.ObjectId.isValid(objectId)) throw new ApiError(400, 'Invalid pagination cursor id')
  return Buffer.from(JSON.stringify({ value: encodeValue(value), id: objectId }), 'utf8').toString('base64url')
}

export const decodeKeysetCursor = (cursor?: string): KeysetCursor | undefined => {
  if (!cursor) return undefined
  if (cursor.length > 1024) throw new ApiError(400, 'Pagination cursor is too long')
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<KeysetCursor>
    if ((typeof parsed.value !== 'string' && typeof parsed.value !== 'number') || !parsed.id || !Types.ObjectId.isValid(parsed.id)) {
      throw new Error('invalid cursor payload')
    }
    return { value: parsed.value, id: parsed.id }
  } catch {
    throw new ApiError(400, 'Invalid pagination cursor')
  }
}

export const buildKeysetRange = (
  sortField: string,
  sortOrder: 'asc' | 'desc' | 1 | -1,
  cursor: KeysetCursor,
  valueParser: (value: KeysetCursor['value']) => unknown = (value) => value,
) => {
  if (!/^[a-zA-Z0-9_.]{1,80}$/.test(sortField)) throw new ApiError(400, 'Invalid pagination sort field')
  const direction = sortOrder === 'asc' || sortOrder === 1 ? '$gt' : '$lt'
  const value = valueParser(cursor.value)
  const id = new Types.ObjectId(cursor.id)
  return {
    $or: [
      { [sortField]: { [direction]: value } },
      { [sortField]: value, _id: { [direction]: id } },
    ],
  }
}
