import sanitizeHtml from 'sanitize-html'

export const sanitizeRichText = (value: string): string => sanitizeHtml(value, {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] }, allowedSchemes: ['http', 'https'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
})

export const sanitizeCustomCss = (value: string): string => {
  const stripped = String(value || '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!stripped) return ''
  // Advanced Builder custom CSS is a declaration list, never a selector sheet.
  // Reject braces/at-rules so a node cannot escape its server-generated selector.
  if (/[{}<>]|<\/style|@(?:import|supports|media|layer|keyframes)|expression\s*\(|javascript:|data:text\/html/i.test(stripped)) {
    throw new Error('Custom CSS contains a disallowed construct')
  }
  if (/url\s*\(\s*['"]?\s*(?!https?:\/\/)/i.test(stripped)) {
    throw new Error('Custom CSS URLs must use HTTPS or HTTP')
  }
  if (/position\s*:\s*(?:fixed|sticky)\b/i.test(stripped)) {
    throw new Error('Custom CSS cannot use fixed or sticky positioning')
  }

  const declarations = stripped.split(';').map((entry) => entry.trim()).filter(Boolean)
  if (declarations.length > 100) throw new Error('Custom CSS contains too many declarations')
  const normalized = declarations.map((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator <= 0) throw new Error('Custom CSS must contain property: value declarations only')
    const property = declaration.slice(0, separator).trim()
    const cssValue = declaration.slice(separator + 1).trim()
    if (!/^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(property) || !cssValue) {
      throw new Error('Custom CSS contains an invalid declaration')
    }
    return `${property}: ${cssValue}`
  }).join('; ')
  if (normalized.length > 20_000) throw new Error('Custom CSS is too large')
  return normalized ? `${normalized};` : ''
}

export const assertSafeUrl = (value: string): string => {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL protocol is not allowed')
  return parsed.toString()
}

export const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'font/woff2',
])
