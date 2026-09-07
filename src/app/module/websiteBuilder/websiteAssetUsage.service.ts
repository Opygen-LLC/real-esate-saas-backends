import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteStudio, WebsiteStudioRevision } from './websiteStudio.model'
import { WebsiteAsset } from './websiteAsset.model'

type Usage = { area: 'published' | 'draft' | 'revision' | 'property'; label: string }
export const valueReferencesAsset = (value: unknown, needles: Set<string>, depth = 0): boolean => {
  if (depth > 40 || value == null) return false
  if (typeof value === 'string') return needles.has(value) || [...needles].some((needle) => value.includes(`url("${needle}")`) || value.includes(`url('${needle}')`) || value.includes(`url(${needle})`))
  if (Array.isArray(value)) return value.some((entry) => valueReferencesAsset(entry, needles, depth + 1))
  if (typeof value === 'object' && 'toHexString' in value && typeof (value as { toHexString?: unknown }).toHexString === 'function') return needles.has((value as { toHexString: () => string }).toHexString())
  if (typeof value === 'object') return Object.values(value).some((entry) => valueReferencesAsset(entry, needles, depth + 1))
  return false
}
const usageForAsset = async (organizationId: string, asset: any, session?: ClientSession, stopAtFirst = false): Promise<Usage[]> => {
  const needles = new Set<string>([String(asset._id), asset.key, asset.url, ...(asset.variants || []).flatMap((item: any) => [item.key, item.url])].filter(Boolean).map(String))
  const usage: Usage[] = []
  const org = await Organization.findOne({ organizationId }).select('logo favicon websiteSettings').session(session || null).lean()
  if (valueReferencesAsset(org, needles)) usage.push({ area: 'published', label: 'Live website or branding' })
  if (stopAtFirst && usage.length) return usage
  const draft = await WebsiteStudio.findOne({ organizationId }).select('snapshot builderPages').session(session || null).lean()
  if (valueReferencesAsset(draft, needles)) usage.push({ area: 'draft', label: 'Website Studio draft' })
  if (stopAtFirst && usage.length) return usage
  // Cursors keep large revision histories out of application memory. Stop as soon
  // as a reference is found for deletion checks; usage summaries are capped, not safety checks.
  const streams = [
    { query: WebsiteStudioRevision.find({ organizationId }).select('snapshot builderPages revision'), area: 'revision' as const, label: 'Website publication history' },
    { query: WebsitePage.find({ organizationId }).select('title draftDocument publishedDocument'), area: 'draft' as const, label: 'Advanced builder page' },
    { query: WebsiteRevision.find({ organizationId }).select('document version'), area: 'revision' as const, label: 'Advanced builder history' },
    { query: Property.find({ organizationId }).select('images mediaLinks'), area: 'property' as const, label: 'Property record' },
  ]
  for (const stream of streams) {
    const cursor = stream.query.session(session || null).lean().cursor()
    try {
      for await (const document of cursor) {
        if (!valueReferencesAsset(document, needles)) continue
        usage.push({ area: stream.area, label: stream.label })
        break
      }
    } finally { await cursor.close() }
    if (stopAtFirst && usage.length) return usage
  }
  return usage
}
const getUsage = async (organizationId: string, assetId: string) => {
  if (!/^[a-f\d]{24}$/i.test(assetId)) throw new ApiError(400, 'Invalid asset identifier')
  const asset = await WebsiteAsset.findOne({ organizationId, _id: assetId }).lean()
  if (!asset) throw new ApiError(404, 'Image not found')
  return { assetId, usage: await usageForAsset(organizationId, asset) }
}
export const WebsiteAssetUsageService = { usageForAsset, getUsage }
