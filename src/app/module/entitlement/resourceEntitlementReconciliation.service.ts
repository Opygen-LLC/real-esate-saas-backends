import type { ClientSession } from 'mongoose'
import { writeAudit } from '../audit/audit.service'
import { CrmConfig } from '../crm/crm.model'
import { DomainRecord } from '../domain/domain.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { RealtimeService } from '../realtime/realtime.service'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { WhatsAppIntegration } from '../whatsapp/whatsapp.model'
import { propertyCountsTowardQuotaFilter } from './entitlement.service'

export interface ResourceEntitlementSnapshot {
  plan: string
  planVersion: number
  maxProperties: number
  maxLeads: number
  maxStorageMb: number
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasSmsAutomation: boolean
  hasPremiumTemplates: boolean
  hasLeadAutomations: boolean
}

export interface ResourceEntitlementReconciliationResult {
  organizationId: string
  properties: {
    limit: number
    used: number
    lockedPropertyIds: string[]
    unlockedPropertyIds: string[]
    subscriptionLockedCount: number
  }
  leads: { limit: number; used: number; overCapacityBy: number; preserved: true }
  premiumTemplates: { entitled: boolean; blocked: boolean; preserved: true }
  customDomain: { entitled: boolean; suspended: boolean; domain: string | null; preserved: true }
  advancedAnalytics: { entitled: boolean; dataPreserved: true }
  whatsappAutomation: { entitled: boolean; suspended: boolean; configurationPreserved: true }
  smsAutomation: { entitled: boolean; cancelledQueuedJobs: number; dataPreserved: true }
  leadAutomations: { entitled: boolean; executionBlocked: boolean; rulesPreserved: true }
  storage: { limitBytes: number; usedBytes: number; overageBytes: number; writesBlocked: boolean; filesPreserved: true }
}

const sessionOptions = (session?: ClientSession) => session ? { session } : undefined
const PREMIUM_TEMPLATE_IDS = new Set(['template-3', 'template-4', 'template-6'])

const propertyPriority = (status: string) => {
  const priorities: Record<string, number> = {
    Available: 0,
    UnderOffer: 1,
    Reserved: 2,
    ComingSoon: 3,
    Draft: 4,
  }
  return priorities[status] ?? 10
}

const compareProperties = (left: any, right: any) => {
  const priority = propertyPriority(String(left.status)) - propertyPriority(String(right.status))
  if (priority !== 0) return priority
  const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0
  const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0
  if (leftCreated !== rightCreated) return leftCreated - rightCreated
  return String(left._id).localeCompare(String(right._id))
}

const reconcileProperties = async (
  organizationId: string,
  previous: ResourceEntitlementSnapshot,
  current: ResourceEntitlementSnapshot,
  session?: ClientSession,
  actorId = 'system',
) => {
  const now = new Date()
  const activeQuery = Property.find({ organizationId, ...propertyCountsTowardQuotaFilter() })
    .select('_id status createdAt quotaLocked quotaLockedReason')
  if (session) activeQuery.session(session)
  const active: any[] = (await activeQuery.lean()).sort(compareProperties)

  const limit = Math.max(0, current.maxProperties)
  const overflow = active.slice(limit)
  const lockedPropertyIds = overflow.map((property) => String(property._id))
  if (overflow.length) {
    await Property.updateMany(
      { _id: { $in: overflow.map((property) => property._id) }, organizationId, quotaLocked: { $ne: true } },
      {
        $set: {
          quotaLocked: true,
          quotaLockedReason: 'subscription_limit',
          quotaLockedAt: now,
          quotaLockedBy: actorId,
        },
      },
      sessionOptions(session),
    )
  }

  const kept = Math.min(active.length, limit)
  let available = Math.max(0, limit - kept)
  const limitIncreased = current.maxProperties > previous.maxProperties
  const unlockedPropertyIds: string[] = []

  if (limitIncreased && available > 0) {
    const lockedQuery = Property.find({
      organizationId,
      quotaLocked: true,
      quotaLockedReason: 'subscription_limit',
      status: { $nin: ['Sold', 'Rented', 'OffMarket'] },
    }).select('_id status createdAt').sort({ createdAt: 1, _id: 1 })
    if (session) lockedQuery.session(session)
    const candidates: any[] = (await lockedQuery.lean()).sort(compareProperties).slice(0, available)
    if (candidates.length) {
      unlockedPropertyIds.push(...candidates.map((property) => String(property._id)))
      await Property.updateMany(
        { _id: { $in: candidates.map((property) => property._id) }, organizationId, quotaLockedReason: 'subscription_limit' },
        { $set: { quotaLocked: false, quotaLockedReason: null, quotaLockedAt: null, quotaLockedBy: null } },
        sessionOptions(session),
      )
      available -= candidates.length
    }
  }

  const countQuery = Property.countDocuments({ organizationId, ...propertyCountsTowardQuotaFilter() })
  const lockedCountQuery = Property.countDocuments({ organizationId, quotaLocked: true, quotaLockedReason: 'subscription_limit' })
  if (session) {
    countQuery.session(session)
    lockedCountQuery.session(session)
  }
  const [used, subscriptionLockedCount] = await Promise.all([countQuery, lockedCountQuery])

  return { limit, used, lockedPropertyIds, unlockedPropertyIds, subscriptionLockedCount }
}

const documentUsesPremiumTemplate = (document: any) => PREMIUM_TEMPLATE_IDS.has(String(document?.template?.id || ''))

const tenantUsesPremiumTemplate = async (organizationId: string, session?: ClientSession) => {
  const orgQuery = Organization.findOne({ organizationId }).select('templateId websiteSettings.renderMode')
  const pagesQuery = WebsitePage.find({ organizationId }).select('draftDocument publishedDocument')
  if (session) { orgQuery.session(session); pagesQuery.session(session) }
  const [organization, pages] = await Promise.all([orgQuery.lean(), pagesQuery.lean()])
  return PREMIUM_TEMPLATE_IDS.has(String((organization as any)?.templateId || ''))
    || pages.some((page: any) => documentUsesPremiumTemplate(page.draftDocument) || documentUsesPremiumTemplate(page.publishedDocument))
}

export const reconcileResourceEntitlements = async (
  organizationId: string,
  previous: ResourceEntitlementSnapshot,
  current: ResourceEntitlementSnapshot,
  options: { session?: ClientSession; actorId?: string; reason?: string } = {},
): Promise<ResourceEntitlementReconciliationResult> => {
  const { session, actorId = 'system', reason = 'Subscription resource entitlements reconciled' } = options
  const organizationQuery = Organization.findOne({ organizationId }).select('_id storageUsedBytes domain domain_Verify')
  if (session) organizationQuery.session(session)
  const organization: any = await organizationQuery.lean()
  if (!organization) throw new Error(`Organization ${organizationId} not found while reconciling resource entitlements`)

  const properties = await reconcileProperties(organizationId, previous, current, session, actorId)

  const { Lead } = await import('../lead/lead.model')
  const { activePipelineLeadFilter } = await import('../lead/leadStatus.contract')
  const leadCountQuery = Lead.countDocuments({ organizationId, ...activePipelineLeadFilter() })
  if (session) leadCountQuery.session(session)
  const leadsUsed = await leadCountQuery

  const premiumInUse = await tenantUsesPremiumTemplate(organizationId, session)
  const premiumBlocked = !current.hasPremiumTemplates && premiumInUse

  const domainQuery = DomainRecord.findOne({ organizationId }).select('domain status tlsStatus lifecycleStatus entitlementStatus')
  if (session) domainQuery.session(session)
  const domain: any = await domainQuery.lean()
  const domainSuspended = Boolean(domain && !current.hasCustomDomain)
  if (domain) {
    await DomainRecord.updateOne(
      { _id: domain._id },
      current.hasCustomDomain
        ? { $set: { entitlementStatus: 'active', entitlementSuspendedAt: null, entitlementSuspendedReason: '' } }
        : { $set: { entitlementStatus: 'suspended', entitlementSuspendedAt: new Date(), entitlementSuspendedReason: reason } },
      sessionOptions(session),
    )
  }

  const whatsappQuery = WhatsAppIntegration.findOne({ organizationId }).select('_id entitlementStatus')
  if (session) whatsappQuery.session(session)
  const whatsapp: any = await whatsappQuery.lean()
  if (whatsapp) {
    await WhatsAppIntegration.updateOne(
      { _id: whatsapp._id },
      current.hasWhatsAppIntegration
        ? { $set: { entitlementStatus: 'active', entitlementSuspendedAt: null } }
        : { $set: { entitlementStatus: 'suspended', entitlementSuspendedAt: new Date() } },
      sessionOptions(session),
    )
  }

  let cancelledQueuedJobs = 0
  if (!current.hasSmsAutomation) {
    const cancellation = await OperationsJob.updateMany(
      { organizationId, type: 'sms_send', status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'cancelled', lastError: 'Cancelled because SMS automation is not included in the current plan' }, $unset: { lockedAt: 1, lockedBy: 1 } },
      sessionOptions(session),
    )
    cancelledQueuedJobs = Number(cancellation.modifiedCount || 0)
  }

  await CrmConfig.updateOne(
    { organizationId },
    { $set: { entitlementExecutionBlocked: !current.hasLeadAutomations }, $setOnInsert: { organizationId } },
    { ...sessionOptions(session), upsert: true },
  )

  const limitBytes = Math.max(0, current.maxStorageMb) * 1024 * 1024
  const usedBytes = Math.max(0, Number(organization.storageUsedBytes || 0))
  const overageBytes = Math.max(0, usedBytes - limitBytes)
  const writesBlocked = usedBytes >= limitBytes

  await Organization.updateOne(
    { organizationId },
    {
      $set: {
        domain_Verify: current.hasCustomDomain ? Boolean(domain?.status === 'verified' && domain?.tlsStatus === 'active') : false,
        'entitlementRestrictions.premiumTemplates': premiumBlocked,
        'entitlementRestrictions.customDomain': !current.hasCustomDomain,
        'entitlementRestrictions.advancedAnalytics': !current.hasAdvancedAnalytics,
        'entitlementRestrictions.whatsAppAutomation': !current.hasWhatsAppIntegration,
        'entitlementRestrictions.smsAutomation': !current.hasSmsAutomation,
        'entitlementRestrictions.leadAutomations': !current.hasLeadAutomations,
        'entitlementRestrictions.storageWrites': writesBlocked,
        'entitlementRestrictions.storageOverageBytes': overageBytes,
        'entitlementRestrictions.updatedAt': new Date(),
      },
    },
    sessionOptions(session),
  )

  const result: ResourceEntitlementReconciliationResult = {
    organizationId,
    properties,
    leads: { limit: current.maxLeads, used: leadsUsed, overCapacityBy: Math.max(0, leadsUsed - current.maxLeads), preserved: true },
    premiumTemplates: { entitled: current.hasPremiumTemplates, blocked: premiumBlocked, preserved: true },
    customDomain: { entitled: current.hasCustomDomain, suspended: domainSuspended, domain: domain?.domain || null, preserved: true },
    advancedAnalytics: { entitled: current.hasAdvancedAnalytics, dataPreserved: true },
    whatsappAutomation: { entitled: current.hasWhatsAppIntegration, suspended: Boolean(whatsapp && !current.hasWhatsAppIntegration), configurationPreserved: true },
    smsAutomation: { entitled: current.hasSmsAutomation, cancelledQueuedJobs, dataPreserved: true },
    leadAutomations: { entitled: current.hasLeadAutomations, executionBlocked: !current.hasLeadAutomations, rulesPreserved: true },
    storage: { limitBytes, usedBytes, overageBytes, writesBlocked, filesPreserved: true },
  }

  const changed = properties.lockedPropertyIds.length > 0
    || properties.unlockedPropertyIds.length > 0
    || previous.hasCustomDomain !== current.hasCustomDomain
    || previous.hasAdvancedAnalytics !== current.hasAdvancedAnalytics
    || previous.hasWhatsAppIntegration !== current.hasWhatsAppIntegration
    || previous.hasSmsAutomation !== current.hasSmsAutomation
    || previous.hasPremiumTemplates !== current.hasPremiumTemplates
    || previous.hasLeadAutomations !== current.hasLeadAutomations
    || previous.maxStorageMb !== current.maxStorageMb
    || previous.maxLeads !== current.maxLeads
    || previous.maxProperties !== current.maxProperties

  if (changed) {
    await writeAudit({
      organizationId,
      actorId,
      actorRole: actorId.startsWith('system:') || actorId === 'system' ? 'system' : undefined,
      action: 'subscription.resources_reconciled',
      entityType: 'organization',
      entityId: String(organization._id),
      reason,
      metadata: result as unknown as Record<string, unknown>,
    }, session)
  }

  return result
}

export const publishResourceEntitlementReconciliation = async (result?: ResourceEntitlementReconciliationResult | null) => {
  if (!result) return
  await CacheInvalidationService.invalidateTenant(result.organizationId)
  for (const propertyId of [...result.properties.lockedPropertyIds, ...result.properties.unlockedPropertyIds]) {
    RealtimeService.emitOrganization(result.organizationId, { type: 'property.changed', action: 'updated', entityId: propertyId })
  }
  RealtimeService.emitOrganization(result.organizationId, { type: 'subscription.changed', action: 'updated', entityId: result.organizationId })
}
