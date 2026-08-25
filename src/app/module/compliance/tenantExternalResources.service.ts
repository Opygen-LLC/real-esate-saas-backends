import httpStatus from 'http-status'
import mongoose, { type Types } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { DomainRecord } from '../domain/domain.model'
import { DomainProviderService } from '../domain/providers'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'

/**
 * Collections that may contain tenant-owned GCS object references created by
 * legacy upload paths. Current managed media is deleted by tenant prefix, but
 * these references are collected before MongoDB deletion so old global
 * `uploads/...` objects can also be removed safely.
 */
export const LEGACY_STORAGE_REFERENCE_COLLECTIONS = [
  'organizations',
  'users',
  'userprofiles',
  'agencyownerprofiles',
  'agentprofiles',
  'properties',
  'banners',
  'sections',
  'landingpages',
  'websiteassets',
  'websiteuploadintents',
  'websitepages',
  'websiterevisions',
  'supporttickets',
  'financetransactions',
] as const

export type TenantExternalResourceManifest = {
  organizationId: string
  storagePrefixes: string[]
  referencedObjectKeys: string[]
  legacyObjectKeys: string[]
  domains: string[]
}

const normalizeDomain = (value: unknown): string | null => {
  const normalized = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '').replace(/^www\./, '')
  if (!normalized || !normalized.includes('.')) return null
  return normalized
}

const addStorageReference = (
  organizationId: string,
  value: string,
  referenced: Set<string>,
  legacy: Set<string>,
) => {
  const key = ObjectStorageService.keyFromReference(value)
  if (!key) return
  const tenantPrefix = `tenants/${organizationId}/`
  const supportPrefix = `support/${organizationId}/`
  if (key.startsWith(tenantPrefix) || key.startsWith(supportPrefix)) {
    referenced.add(key)
    return
  }
  // Old upload.service.ts stored directly below uploads/. These names include
  // timestamp + random bytes and are only removed when referenced by this
  // tenant's own records collected before the database purge.
  if (key.startsWith('uploads/')) {
    referenced.add(key)
    legacy.add(key)
  }
}

const walkStorageReferences = (
  organizationId: string,
  value: unknown,
  referenced: Set<string>,
  legacy: Set<string>,
  depth = 0,
) => {
  if (depth > 16 || value == null) return
  if (typeof value === 'string') {
    addStorageReference(organizationId, value, referenced, legacy)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => walkStorageReferences(organizationId, entry, referenced, legacy, depth + 1))
    return
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      walkStorageReferences(organizationId, child, referenced, legacy, depth + 1)
    }
  }
}

const collectStorageReferences = async (organizationId: string, userIds: Types.ObjectId[]) => {
  const referenced = new Set<string>()
  const legacy = new Set<string>()

  for (const collectionName of LEGACY_STORAGE_REFERENCE_COLLECTIONS) {
    let filter: Record<string, unknown> = { organizationId }
    if (collectionName === 'userprofiles') {
      if (!userIds.length) continue
      filter = { userId: { $in: userIds } }
    } else if (collectionName === 'users') {
      filter = { organizationId }
    }

    const cursor = mongoose.connection.collection(collectionName).find(filter, { batchSize: 100 })
    for await (const document of cursor) {
      walkStorageReferences(organizationId, document, referenced, legacy)
    }
  }

  return {
    referencedObjectKeys: [...referenced].sort(),
    legacyObjectKeys: [...legacy].sort(),
  }
}

const collectDomains = async (organizationId: string) => {
  const [organization, record] = await Promise.all([
    Organization.findOne({ organizationId }).select('domain').lean(),
    DomainRecord.findOne({ organizationId }).select('domain candidate.domain retiredDomains.domain').lean(),
  ])

  const domains = new Set<string>()
  const add = (value: unknown) => {
    const normalized = normalizeDomain(value)
    if (normalized) domains.add(normalized)
  }
  add((organization as any)?.domain)
  add((record as any)?.domain)
  add((record as any)?.candidate?.domain)
  for (const retired of (record as any)?.retiredDomains || []) add(retired?.domain)
  return [...domains].sort()
}

const collect = async (organizationId: string, userIds: Types.ObjectId[]): Promise<TenantExternalResourceManifest> => {
  const [storage, domains] = await Promise.all([
    collectStorageReferences(organizationId, userIds),
    collectDomains(organizationId),
  ])
  return {
    organizationId,
    storagePrefixes: [`tenants/${organizationId}/`, `support/${organizationId}/`],
    referencedObjectKeys: storage.referencedObjectKeys,
    legacyObjectKeys: storage.legacyObjectKeys,
    domains,
  }
}

const mapWithConcurrency = async <T>(values: T[], limit: number, task: (value: T) => Promise<void>) => {
  let index = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, values.length)) }, async () => {
    while (index < values.length) {
      const current = values[index]
      index += 1
      await task(current)
    }
  })
  await Promise.all(workers)
}

const deleteStorage = async (manifest: TenantExternalResourceManifest) => {
  const status = ObjectStorageService.configurationStatus()
  if (!status.configured) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Tenant storage cannot be purged because Google Cloud Storage is not configured',
      '',
      'TENANT_PURGE_STORAGE_FAILED',
      { missing: status.missing },
    )
  }

  try {
    await Promise.all(manifest.storagePrefixes.map((prefix) => ObjectStorageService.removePrefix(prefix)))
    await mapWithConcurrency(manifest.legacyObjectKeys, 20, (key) => ObjectStorageService.remove(key))
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TENANT_PURGE_STORAGE_FAILED') throw error
    logger.error('tenant_storage_purge_failed', { organizationId: manifest.organizationId, error })
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Tenant Google Cloud Storage cleanup failed',
      '',
      'TENANT_PURGE_STORAGE_FAILED',
      { reason: error instanceof Error ? error.message : String(error) },
    )
  }
}

const deleteDomains = async (manifest: TenantExternalResourceManifest) => {
  if (!manifest.domains.length) return
  const provider = DomainProviderService.current()
  try {
    // Provider removal is idempotent. VercelDomainProvider removes both apex
    // and www for each domain root.
    await mapWithConcurrency(manifest.domains, 4, (domain) => provider.removeDomain(domain))
  } catch (error) {
    logger.error('tenant_domain_provider_purge_failed', { organizationId: manifest.organizationId, domains: manifest.domains, provider: provider.name, error })
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Tenant custom-domain provider cleanup failed',
      '',
      'TENANT_PURGE_DOMAIN_FAILED',
      { provider: provider.name, reason: error instanceof Error ? error.message : String(error) },
    )
  }
}

const verifyDeleted = async (manifest: TenantExternalResourceManifest) => {
  const provider = DomainProviderService.current()
  const [prefixResults, legacyResults, domainResults] = await Promise.all([
    Promise.all(manifest.storagePrefixes.map(async (prefix) => ({ prefix, exists: await ObjectStorageService.prefixHasObjects(prefix) }))),
    Promise.all(manifest.legacyObjectKeys.map(async (key) => ({ key, exists: await ObjectStorageService.exists(key) }))),
    Promise.all(manifest.domains.map(async (domain) => ({ domain, exists: await provider.hasDomain(domain) }))),
  ])

  const remainingStoragePrefixes = prefixResults.filter((entry) => entry.exists).map((entry) => entry.prefix)
  const remainingLegacyObjects = legacyResults.filter((entry) => entry.exists).map((entry) => entry.key)
  const remainingDomains = domainResults.filter((entry) => entry.exists).map((entry) => entry.domain)

  if (remainingStoragePrefixes.length || remainingLegacyObjects.length || remainingDomains.length) {
    const details = { organizationId: manifest.organizationId, remainingStoragePrefixes, remainingLegacyObjects, remainingDomains }
    logger.error('tenant_external_resource_verification_failed', details)
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant external-resource purge is incomplete',
      '',
      'TENANT_PURGE_EXTERNAL_CLEANUP_FAILED',
      details,
    )
  }
}

export const TenantExternalResourcesService = {
  collect,
  deleteStorage,
  deleteDomains,
  verifyDeleted,
}
