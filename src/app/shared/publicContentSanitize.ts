import { sanitizeRichText } from '../helpers/sanitize'

const dangerousKey = new Set(['__proto__', 'prototype', 'constructor'])
const controlChars = /[\u0000-\u001F\u007F]/
const unsafeTextPattern = /(?:javascript\s*:|data\s*:\s*text\/html|on(?:error|load|click)\s*=)/i

export const sanitizePublicUrl = (
  value: unknown,
  options: { allowRelative?: boolean; allowContactSchemes?: boolean } = {},
): string => {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input || controlChars.test(input)) return ''

  if (options.allowRelative && (input.startsWith('/') || input.startsWith('#'))) {
    return input.startsWith('//') ? '' : input
  }

  try {
    const parsed = new URL(input)
    const allowed = options.allowContactSchemes
      ? new Set(['http:', 'https:', 'mailto:', 'tel:'])
      : new Set(['http:', 'https:'])
    if (!allowed.has(parsed.protocol) || parsed.username || parsed.password) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export const sanitizeStructuredPublicContent = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return null
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const bounded = value.slice(0, 5_000)
    if (unsafeTextPattern.test(bounded)) return ''
    return bounded.includes('<') ? sanitizeRichText(bounded) : bounded
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeStructuredPublicContent(item, depth + 1))
  }
  if (!value || typeof value !== 'object') return null

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !dangerousKey.has(key) && key.length <= 120)
      .slice(0, 100)
      .map(([key, child]) => [key, sanitizeStructuredPublicContent(child, depth + 1)]),
  )
}
