import { Cache } from '../../../shared/cache'
import { RedisClient } from '../../../shared/redisClient'
import { DomainRecord } from '../domain/domain.model'
import { SubdomainAlias } from '../domain/subdomainAlias.model'
import { Organization } from '../organization/organization.model'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { WebsiteCache } from '../websiteBuilder/websiteCache'

type CacheEvent = { organizationId: string; aggregateType: string; eventType: string; payload?: Record<string, unknown> }

const invalidateTenant = async (organizationId: string, extraIdentifiers: string[] = []) => {
  if (!organizationId || organizationId === '__platform__') return [] as string[]

  const [org, domains, aliases, pages] = await Promise.all([
    Organization.findOne({ organizationId }).select('organizationId sub_domain domain').lean(),
    DomainRecord.find({ organizationId }).select('domain').lean(),
    SubdomainAlias.find({ organizationId }).select('alias').lean(),
    WebsitePage.find({ organizationId }).select('_id slug').lean(),
  ])

  const identifiers = Array.from(
    new Set(
      [
        organizationId,
        org?.organizationId,
        org?.sub_domain,
        org?.domain,
        ...domains.map((record: any) => record.domain),
        ...aliases.map((record: any) => record.alias),
        ...extraIdentifiers,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
    )
  )

  await Promise.all([
    Cache.tenantPublic.del(...identifiers),
    Cache.tenantResolve.del(...identifiers),
    // Delete the complete tenant website-cache namespace as well as the
    // explicit keys below. delAll uses Redis SCAN and catches stale/legacy page
    // cache keys that are no longer represented by a WebsitePage document.
    Cache.website.delAll(organizationId),
    ...pages.flatMap((page: any) => [
      WebsiteCache.del('draft', organizationId, String(page._id)),
      WebsiteCache.del('published', organizationId, String(page.slug || '/')),
    ]),
    WebsiteCache.del('published', organizationId, '/'),
  ])
  return identifiers
}

const countTenantKeys = async (organizationId: string, extraIdentifiers: string[] = []) => {
  if (!organizationId || organizationId === '__platform__') return 0
  const identifiers = Array.from(new Set([organizationId, ...extraIdentifiers].filter(Boolean).map((value) => String(value).trim().toLowerCase())))
  const [websiteCount, publicCounts, resolveCounts] = await Promise.all([
    Cache.website.countAll(organizationId),
    Promise.all(identifiers.map((identifier) => RedisClient.countMatching('tenant-public', encodeURIComponent(identifier).slice(0, 320)))),
    Promise.all(identifiers.map((identifier) => RedisClient.countMatching('tenant-resolve', encodeURIComponent(identifier).slice(0, 320)))),
  ])
  return websiteCount + publicCounts.reduce((sum, value) => sum + value, 0) + resolveCounts.reduce((sum, value) => sum + value, 0)
}

const fromEvent = async (event: CacheEvent): Promise<void> => {
  if (event.aggregateType === 'subscription_plan' || event.eventType.startsWith('plan.')) {
    await Cache.plans.del('catalog')
    return
  }
  if (['organization', 'website', 'domain', 'property'].includes(event.aggregateType)) await invalidateTenant(event.organizationId)
}

export const CacheInvalidationService = { fromEvent, invalidateTenant, countTenantKeys }
