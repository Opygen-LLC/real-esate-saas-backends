import { sanitizeRichText } from '../../helpers/sanitize'

export const serializePublicLandingPage = (page: any) => ({
  _id: String(page._id),
  title: String(page.title || '').slice(0, 160),
  slug: String(page.slug || '').slice(0, 120),
  content: sanitizeRichText(String(page.content || '').slice(0, 100_000)),
  metaTitle: String(page.metaTitle || '').slice(0, 160),
  metaDescription: String(page.metaDescription || '').slice(0, 500),
  status: true,
})
