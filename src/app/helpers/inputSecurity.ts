import { z } from 'zod'
import ApiError from '../../errors/ApiError'
import config from '../../config'

const DANGEROUS_EXACT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/
const SAFE_HEADER_TOKEN = /^[A-Za-z0-9._~:+\-/=]{1,256}$/

export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid resource id')
export const tenantIdSchema = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9_-]+$/, 'Invalid organization id')
export const safeFieldNameSchema = z.string().trim().regex(SAFE_FIELD_NAME, 'Invalid field name').refine((value) => !DANGEROUS_EXACT_KEYS.has(value), 'Invalid field name')
export const sortOrderSchema = z.enum(['asc', 'desc'])
export const pageSchema = z.coerce.number().int().min(1).max(1_000_000)
export const pageSizeSchema = z.coerce.number().int().min(1).max(config.runtime.max_page_size)
export const cursorSchema = z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9._~:+\-/=]+$/, 'Invalid cursor')
export const isoDateSchema = z.string().datetime({ offset: true })
export const moneySchema = z.coerce.number().finite().min(0).max(1_000_000_000_000)
export const latitudeSchema = z.coerce.number().finite().min(-90).max(90)
export const longitudeSchema = z.coerce.number().finite().min(-180).max(180)
export const coordinateSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema }).strict()

export const httpUrlSchema = z.string().trim().max(2048).superRefine((value, ctx) => {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL must use HTTP(S) without embedded credentials' })
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid URL' })
  }
})

export const httpsUrlSchema = z.string().trim().max(2048).superRefine((value, ctx) => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL must use HTTPS without embedded credentials' })
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid URL' })
  }
})

export const paginationQuerySchema = z.object({
  page: pageSchema.optional(),
  limit: pageSizeSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  cursor: cursorSchema.optional(),
}).strict()

export const sortedPaginationQuerySchema = <T extends readonly [string, ...string[]]>(fields: T) =>
  paginationQuerySchema.extend({ sortBy: z.enum(fields).optional() }).strict()

export const commonRequestHeadersSchema = z.object({
  'x-request-id': z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._-]+$/).optional(),
  'x-csrf-token': z.string().trim().min(24).max(256).regex(SAFE_HEADER_TOKEN).optional(),
  'idempotency-key': z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._~:+\-/=]+$/).optional(),
  origin: z.string().trim().max(2048).optional(),
  'user-agent': z.string().max(1000).optional(),
}).passthrough()

export const uploadedFileMetadataSchema = z.object({
  originalname: z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000]/.test(value), 'Invalid filename'),
  mimetype: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'font/woff2']),
  size: z.number().int().positive().max(5 * 1024 * 1024),
}).passthrough()

export const idParamSchema = (name = 'id') => z.object({ params: z.object({ [name]: objectIdSchema }).strict() })
export const tenantParamSchema = (name = 'organizationId') => z.object({ params: z.object({ [name]: tenantIdSchema }).strict() })

export const hasDangerousMongoKey = (key: string): boolean =>
  DANGEROUS_EXACT_KEYS.has(key) || key.startsWith('$') || key.includes('.') || CONTROL_CHARS.test(key)

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const assertSafeInputTree = (
  value: unknown,
  options: { label?: string; maxDepth?: number; maxKeys?: number; maxArrayLength?: number } = {},
): void => {
  const label = options.label || 'Request input'
  const maxDepth = options.maxDepth ?? 12
  const maxKeys = options.maxKeys ?? 2_000
  const maxArrayLength = options.maxArrayLength ?? 2_000
  let visitedKeys = 0

  const visit = (node: unknown, depth: number, path: string): void => {
    if (depth > maxDepth) throw new ApiError(400, `${label} is nested too deeply`, '', 'UNSAFE_REQUEST_INPUT')
    if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') return
    if (Array.isArray(node)) {
      if (node.length > maxArrayLength) throw new ApiError(400, `${label} contains too many array items`, '', 'UNSAFE_REQUEST_INPUT')
      node.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      return
    }
    if (!isPlainObject(node)) throw new ApiError(400, `${label} contains an unsupported object value`, '', 'UNSAFE_REQUEST_INPUT')

    for (const [key, child] of Object.entries(node)) {
      visitedKeys += 1
      if (visitedKeys > maxKeys) throw new ApiError(400, `${label} contains too many fields`, '', 'UNSAFE_REQUEST_INPUT')
      if (hasDangerousMongoKey(key)) {
        throw new ApiError(400, `Unsafe field name at ${path || 'request'}: ${key}`, '', 'UNSAFE_REQUEST_INPUT')
      }
      visit(child, depth + 1, path ? `${path}.${key}` : key)
    }
  }

  visit(value, 0, '')
}

export const assertSafeCommonQuery = (query: Record<string, unknown>): void => {
  const validate = <T>(schema: z.ZodType<T>, key: string): void => {
    if (query[key] === undefined) return
    const parsed = schema.safeParse(query[key])
    if (!parsed.success) throw new ApiError(400, `Invalid query parameter: ${key}`, '', 'INVALID_QUERY_PARAMETER')
  }
  validate(pageSchema, 'page')
  validate(pageSizeSchema, 'limit')
  validate(sortOrderSchema, 'sortOrder')
  validate(safeFieldNameSchema, 'sortBy')
  validate(cursorSchema, 'cursor')
}

export const assertSafeRequestHeaders = (headers: Record<string, unknown>): void => {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value
  const parsed = commonRequestHeadersSchema.safeParse(normalized)
  if (!parsed.success) throw new ApiError(400, 'Request contains an invalid security-sensitive header', '', 'INVALID_REQUEST_HEADER')

  const origin = typeof normalized.origin === 'string' ? normalized.origin.trim() : ''
  if (origin) {
    try {
      const parsedOrigin = new URL(origin)
      if (parsedOrigin.origin !== origin.replace(/\/$/, '') || parsedOrigin.username || parsedOrigin.password) {
        throw new Error('not an origin')
      }
    } catch {
      throw new ApiError(400, 'Origin header must be a valid origin', '', 'INVALID_REQUEST_HEADER')
    }
  }
}

export const assertAllowedSortField = (
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): string => {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return allowed.has(candidate) ? candidate : fallback
}
