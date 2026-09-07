import ApiError from '../../../errors/ApiError'
import { Property } from '../property/property.model'
import { PUBLIC_PROPERTY_STATUSES } from '../property/property.constants'
import { getTemplateContentDefaults } from '../../../contracts/websiteCatalog/manifest'
import { mergeWebsiteContentPatch, migrateWebsiteContent, validateWebsiteContentPatch, type WebsiteContentPatch } from '../../../contracts/websiteCatalog/content'
import type { OrganizationWebsiteSettings } from '../organization/organizationWebsite.contract'

/** Validate new curated references, never accept copied property facts as Studio content. */
export const assertContentPropertyReferences = async (organizationId: string, patch: WebsiteContentPatch, current?: WebsiteContentPatch): Promise<void> => {
  const existing = new Set([current?.home?.heroPropertyId, ...(current?.home?.featuredPropertyIds || [])].filter(Boolean).map((id) => String(id).toLowerCase()))
  const ids = [...new Set([patch.home?.heroPropertyId, ...(patch.home?.featuredPropertyIds || [])].filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase()))].filter((id) => !existing.has(id))
  if (!ids.length) return
  const count = await Property.countDocuments({
    organizationId, _id: { $in: ids }, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true },
  }).maxTimeMS(10_000)
  if (count !== ids.length) throw new ApiError(400, 'Choose available published properties belonging to this agency', undefined, 'INVALID_CONTENT_PROPERTY_REFERENCE')
}

export const mergeAndMigrateContent = (
  current: OrganizationWebsiteSettings | undefined,
  patch: WebsiteContentPatch | undefined,
  templateId: string,
) => {
  if (patch !== undefined) {
    const issues = validateWebsiteContentPatch(patch)
    if (issues.length) throw new ApiError(400, 'Invalid website content', '', 'INVALID_WEBSITE_CONTENT', { issues }, Object.fromEntries(issues.map((issue) => [`websiteSettings.content.${issue.path}`, [issue.message]])))
  }
  try {
    return migrateWebsiteContent({
      ...current,
      content: patch === undefined ? current?.content : mergeWebsiteContentPatch(current?.content, patch),
    }, getTemplateContentDefaults(templateId))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(409, error instanceof Error ? error.message : 'Website content migration failed')
  }
}
