import sanitizeHtml from 'sanitize-html'

export const sanitizeRichText = (value: string): string => sanitizeHtml(value, {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] }, allowedSchemes: ['http', 'https'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
})

export const sanitizeCustomCss = (value: string): string => {
  if (/@import|expression\s*\(|javascript:|data:text\/html|url\s*\(\s*['"]?\s*(?!https?:)/i.test(value)) {
    throw new Error('Custom CSS contains a disallowed construct')
  }
  return value.slice(0, 100_000)
}

export const assertSafeUrl = (value: string): string => {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL protocol is not allowed')
  return parsed.toString()
}

export const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'font/woff2',
])
