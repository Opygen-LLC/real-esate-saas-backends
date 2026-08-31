import ApiError from '../../errors/ApiError'

export const DEFAULT_SEARCH_TERM_MAX_LENGTH = 120

export const normalizeSearchTerm = (
  value: unknown,
  options: { maxLength?: number; label?: string } = {},
): string => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  const maxLength = options.maxLength ?? DEFAULT_SEARCH_TERM_MAX_LENGTH
  if (normalized.length > maxLength) {
    throw new ApiError(400, `${options.label || 'Search term'} must be ${maxLength} characters or fewer`)
  }
  return normalized
}

export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const safeRegexPattern = (value: unknown, options?: { maxLength?: number; label?: string }): string =>
  escapeRegex(normalizeSearchTerm(value, options))

export const safeSearchRegex = (value: unknown, options?: { maxLength?: number; label?: string }): RegExp =>
  new RegExp(safeRegexPattern(value, options), 'i')

export const exactCaseInsensitiveRegex = (value: unknown, options?: { maxLength?: number; label?: string }): RegExp =>
  new RegExp(`^${safeRegexPattern(value, options)}$`, 'i')
