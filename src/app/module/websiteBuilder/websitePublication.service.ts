import type { ClientSession } from 'mongoose'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { Organization } from '../organization/organization.model'
import type { WebsiteRenderMode } from './websiteArchitecture.contract'

type CommitPublicationInput = {
  organizationId: string
  renderMode: WebsiteRenderMode
  set?: Record<string, unknown>
  unset?: Record<string, ''>
  session?: ClientSession | null
}

type AfterPublicationInput = {
  organizationId: string
  renderMode: WebsiteRenderMode
  aggregateId: string
  actorId?: string
  slug?: string
  builderVersion?: number
  publicationRevision?: number
  eventType?: string
}

const commitPublicationState = async ({ organizationId, renderMode, set = {}, unset = {}, session }: CommitPublicationInput) => {
  const lastPublishedAt = new Date()
  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    {
      $set: {
        ...set,
        websiteStatus: 'published',
        'websiteSettings.renderMode': renderMode,
        'websiteSettings.lastPublishedAt': lastPublishedAt,
      },
      $inc: { 'websiteSettings.publicationRevision': 1 },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { new: true, ...(session ? { session } : {}) },
  )

  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  return {
    organization,
    publicationRevision: Number(organization.websiteSettings?.publicationRevision || 0),
    lastPublishedAt: organization.websiteSettings?.lastPublishedAt || lastPublishedAt,
  }
}

const afterPublication = async ({
  organizationId,
  renderMode,
  aggregateId,
  actorId,
  slug,
  builderVersion,
  publicationRevision,
  eventType = 'website.published',
}: AfterPublicationInput) => {
  const identifiers = await CacheInvalidationService.invalidateTenant(organizationId)
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'website',
    aggregateId,
    eventType,
    actorId,
    payload: {
      renderMode,
      slug,
      builderVersion,
      publicationRevision,
      cacheInvalidated: true,
      tenantIdentifiers: identifiers,
    },
  })
  return identifiers
}

export const WebsitePublicationService = { commitPublicationState, afterPublication }
