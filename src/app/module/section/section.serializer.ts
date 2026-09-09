import { sanitizeStructuredPublicContent } from '../../shared/publicContentSanitize'

export const serializePublicSection = (section: any) => ({
  _id: String(section._id),
  name: String(section.name || '').slice(0, 100),
  type: section.type,
  title: String(section.title || '').slice(0, 160),
  subtitle: String(section.subtitle || '').slice(0, 500),
  limit: Math.max(0, Math.min(100, Number(section.limit || 0))),
  order: Math.max(-1_000, Math.min(1_000, Number(section.order || 0))),
  content: sanitizeStructuredPublicContent(section.content) || {},
  status: true,
})
