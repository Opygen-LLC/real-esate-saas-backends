import type { StudioSnapshot } from '../../../contracts/websiteCatalog/studio'
import { WEBSITE_CONTENT_FIELDS } from '../../../contracts/websiteCatalog/content'
/** Only these bundled, provenance-recorded defaults are accepted without a tenant asset. */
export const BUNDLED_STUDIO_IMAGES: readonly string[] = [] // Defaults are securely imported; no unowned remote asset bypass.
export const isBundledStudioImage = (value: string): boolean => (BUNDLED_STUDIO_IMAGES as readonly string[]).includes(value)
export const collectStudioImageUrls = (snapshot: StudioSnapshot): string[] => {
  const urls = [snapshot.logo, snapshot.favicon]
  for (const [page, fields] of Object.entries(WEBSITE_CONTENT_FIELDS)) {
    const content = snapshot.websiteSettings.content[page as keyof typeof snapshot.websiteSettings.content] as Record<string, unknown> | undefined
    for (const [key, definition] of Object.entries(fields)) {
      const value = content?.[key]
      if (definition.kind === 'image' && typeof value === 'string') urls.push(value)
      if (definition.kind === 'images' && Array.isArray(value)) for (const item of value) if (typeof item?.image === 'string') urls.push(item.image)
    }
  }
  return [...new Set(urls.filter(Boolean))]
}
