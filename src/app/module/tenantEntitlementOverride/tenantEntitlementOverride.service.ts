import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  publishSubscriptionEntitlementReconciliation,
  reconcileOrganizationEntitlements,
  type SubscriptionEntitlementInput,
  type SubscriptionEntitlementReconciliationResult,
} from '../entitlement/subscriptionEntitlementReconciliation.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { writeAudit } from '../audit/audit.service'
import { TenantEntitlementOverride } from './tenantEntitlementOverride.model'
import type { ITenantEntitlementOverride } from './tenantEntitlementOverride.interface'
import { applyTenantEntitlementOverride } from './tenantEntitlementOverride.resolver'

export type TenantEntitlementOverrideInput = Pick<ITenantEntitlementOverride, 'resources' | 'features'> & {
  expiresAt?: string | Date | null
  reason: string
}

type Actor = { id: string; requestId?: string; ip?: string }

const hasMeaningfulOverride = (input: TenantEntitlementOverrideInput) => {
  const resources = input.resources || {}
  const features = input.features || {}
  return Object.values(resources).some(Boolean) || Object.values(features).some((value) => typeof value === 'boolean')
}

const snapshotInput = (resolved: any): SubscriptionEntitlementInput => ({
  plan: String(resolved.organization.subscription?.plan || 'trial'),
  planVersion: Number(resolved.organization.subscription?.planVersion || 1),
  maxTeamMembers: Number(resolved.limits.maxTeamMembers || 0),
  maxProperties: Number(resolved.limits.maxProperties || 0),
  maxLeads: Number(resolved.limits.maxLeads || 0),
  leadAllowanceModel: resolved.limits.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
  maxStorageMb: Number(resolved.limits.maxStorageMb || 0),
  hasCustomDomain: Boolean(resolved.limits.hasCustomDomain),
  hasAdvancedAnalytics: Boolean(resolved.limits.hasAdvancedAnalytics),
  hasWhatsAppIntegration: Boolean(resolved.limits.hasWhatsAppIntegration),
  hasSmsAutomation: Boolean(resolved.limits.hasSmsAutomation),
  hasPremiumTemplates: Boolean(resolved.limits.hasPremiumTemplates),
  hasLeadAutomations: Boolean(resolved.limits.hasLeadAutomations),
  hasAdvancedAccounting: Boolean(resolved.limits.hasAdvancedAccounting),
  tenantOverrideApplied: true,
})

const expireStaleActive = async (organizationId: string, session?: ClientSession, now = new Date()) => {
  const query = TenantEntitlementOverride.updateMany(
    { organizationId, status: 'active', expiresAt: { $ne: null, $lte: now } },
    { $set: { status: 'expired' }, $unset: { activeKey: 1 } },
  )
  if (session) query.session(session)
  return query
}

const getHistory = async (organizationId: string) => {
  await expireStaleActive(organizationId)
  return TenantEntitlementOverride.find({ organizationId }).sort({ version: -1, _id: -1 }).lean()
}

const createOrReplace = async (organizationId: string, input: TenantEntitlementOverrideInput, actor: Actor) => {
  if (!hasMeaningfulOverride(input)) throw new ApiError(httpStatus.BAD_REQUEST, 'At least one tenant-specific entitlement override is required')
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new ApiError(httpStatus.BAD_REQUEST, 'Override expiry must be in the future')

  let created: any = null
  let reconciliation: SubscriptionEntitlementReconciliationResult | null = null
  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    const orgQuery = Organization.findOne({ organizationId }).select('organizationId platformAccess.status isBlocked')
    if (session) orgQuery.session(session)
    const organization: any = await orgQuery.lean()
    if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
    if (organization.platformAccess?.status === 'pending_deletion') throw new ApiError(httpStatus.CONFLICT, 'Tenant entitlement overrides cannot be changed while deletion is pending')

    await expireStaleActive(organizationId, session)
    const before = await EntitlementService.resolve(organizationId, session, { allowInactive: true, allowUnavailable: true })
    const versionQuery = TenantEntitlementOverride.findOne({ organizationId }).sort({ version: -1 }).select('version')
    if (session) versionQuery.session(session)
    const latest: any = await versionQuery.lean()

    const revokeQuery = TenantEntitlementOverride.updateMany(
      { organizationId, status: 'active' },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actor.id, revokeReason: 'Replaced by a newer tenant-specific entitlement override' }, $unset: { activeKey: 1 } },
    )
    if (session) revokeQuery.session(session)
    await revokeQuery

    const docs = await TenantEntitlementOverride.create([{
      organizationId,
      version: Number(latest?.version || 0) + 1,
      activeKey: organizationId,
      status: 'active',
      resources: input.resources || {},
      features: input.features || {},
      startsAt: new Date(),
      expiresAt,
      reason: input.reason,
      createdBy: actor.id,
    }], session ? { session } : undefined)
    created = docs[0]

    const after = await EntitlementService.resolve(organizationId, session, { allowInactive: true, allowUnavailable: true })
    reconciliation = await reconcileOrganizationEntitlements(organizationId, snapshotInput(before), snapshotInput(after), {
      session,
      actorId: actor.id,
      reason: `Tenant-specific entitlement override v${created.version} applied`,
    })

    await writeAudit({
      organizationId,
      actorId: actor.id,
      actorRole: 'super-admin',
      action: 'subscription.tenant_entitlement_override_applied',
      entityType: 'tenantEntitlementOverride',
      entityId: String(created._id),
      reason: input.reason,
      requestId: actor.requestId,
      ip: actor.ip,
      metadata: {
        version: created.version,
        resources: input.resources || {},
        features: input.features || {},
        expiresAt,
        effectiveBefore: snapshotInput(before),
        effectiveAfter: snapshotInput(after),
      },
    }, session)
  })

  await publishSubscriptionEntitlementReconciliation(reconciliation)
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'tenant_override_applied', entityId: String(created._id) })
  return created
}

const revoke = async (organizationId: string, reason: string, actor: Actor) => {
  let revoked: any = null
  let reconciliation: SubscriptionEntitlementReconciliationResult | null = null
  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    await expireStaleActive(organizationId, session)
    const query = TenantEntitlementOverride.findOne({ organizationId, status: 'active' }).sort({ version: -1 })
    if (session) query.session(session)
    const row: any = await query
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'No active tenant-specific entitlement override exists')
    const before = await EntitlementService.resolve(organizationId, session, { allowInactive: true, allowUnavailable: true })
    row.status = 'revoked'; row.revokedAt = new Date(); row.revokedBy = actor.id; row.revokeReason = reason; row.activeKey = undefined
    await row.save(session ? { session } : undefined)
    revoked = row
    const after = await EntitlementService.resolve(organizationId, session, { allowInactive: true, allowUnavailable: true })
    reconciliation = await reconcileOrganizationEntitlements(organizationId, snapshotInput(before), snapshotInput(after), {
      session,
      actorId: actor.id,
      reason: `Tenant-specific entitlement override v${row.version} revoked`,
    })
    await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.tenant_entitlement_override_revoked', entityType: 'tenantEntitlementOverride', entityId: String(row._id), reason, requestId: actor.requestId, ip: actor.ip, metadata: { version: row.version, effectiveBefore: snapshotInput(before), effectiveAfter: snapshotInput(after) } }, session)
  })
  await publishSubscriptionEntitlementReconciliation(reconciliation)
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'subscription.changed', action: 'tenant_override_revoked', entityId: String(revoked._id) })
  return revoked
}

const applyDueExpirations = async (limit = 50, now = new Date()) => {
  const due: any[] = await TenantEntitlementOverride.find({ status: 'active', expiresAt: { $ne: null, $lte: now } }).sort({ expiresAt: 1, _id: 1 }).limit(Math.max(1, Math.min(500, limit))).lean()
  let expired = 0
  const failed: Array<{ organizationId: string; error: string }> = []
  for (const dueRow of due) {
    const tenantAllowed = await Organization.exists({
      organizationId: dueRow.organizationId,
      'platformAccess.status': { $ne: 'pending_deletion' },
    })
    if (!tenantAllowed) continue
    try {
      let reconciliation: SubscriptionEntitlementReconciliationResult | null = null
      await EntitlementService.withTeamMemberQuotaGuard(dueRow.organizationId, async (session) => {
        // At/after expiresAt the normal resolver intentionally excludes the override.
        // Resolve the post-expiry/base state first, then reconstruct the pre-expiry
        // effective state from the persisted due override so reconciliation can lock
        // or unlock resources correctly at the boundary.
        const baseAfterExpiry = await EntitlementService.resolve(dueRow.organizationId, session, { allowInactive: true, allowUnavailable: true })
        const effectiveBeforeLimits = applyTenantEntitlementOverride({
          maxLeads: Number(baseAfterExpiry.limits.maxLeads || 0),
          maxProperties: Number(baseAfterExpiry.limits.maxProperties || 0),
          maxTeamMembers: Number(baseAfterExpiry.limits.maxTeamMembers || 0),
          maxStorageMb: Number(baseAfterExpiry.limits.maxStorageMb || 0),
          maxMonthlyVisitors: Number(baseAfterExpiry.limits.maxMonthlyVisitors || 0),
          hasCustomDomain: Boolean(baseAfterExpiry.limits.hasCustomDomain),
          hasAdvancedAnalytics: Boolean(baseAfterExpiry.limits.hasAdvancedAnalytics),
          hasWhatsAppIntegration: Boolean(baseAfterExpiry.limits.hasWhatsAppIntegration),
          hasSmsAutomation: Boolean(baseAfterExpiry.limits.hasSmsAutomation),
          hasLeadAutomations: Boolean(baseAfterExpiry.limits.hasLeadAutomations),
          hasPremiumTemplates: Boolean(baseAfterExpiry.limits.hasPremiumTemplates),
          hasAdvancedAccounting: Boolean(baseAfterExpiry.limits.hasAdvancedAccounting),
        }, dueRow as ITenantEntitlementOverride)
        const before = {
          ...baseAfterExpiry,
          limits: { ...baseAfterExpiry.limits, ...effectiveBeforeLimits },
        }
        const update = TenantEntitlementOverride.updateOne({ _id: dueRow._id, status: 'active' }, { $set: { status: 'expired' }, $unset: { activeKey: 1 } })
        if (session) update.session(session)
        const result = await update
        if (!result.modifiedCount) return
        const after = await EntitlementService.resolve(dueRow.organizationId, session, { allowInactive: true, allowUnavailable: true })
        reconciliation = await reconcileOrganizationEntitlements(dueRow.organizationId, snapshotInput(before), snapshotInput(after), { session, actorId: 'system:tenant-override-expiry', reason: `Tenant-specific entitlement override v${dueRow.version} expired` })
        await writeAudit({ organizationId: dueRow.organizationId, actorId: 'system:tenant-override-expiry', actorRole: 'system', action: 'subscription.tenant_entitlement_override_expired', entityType: 'tenantEntitlementOverride', entityId: String(dueRow._id), reason: 'Tenant-specific entitlement override reached its configured expiry', metadata: { version: dueRow.version, expiresAt: dueRow.expiresAt } }, session)
        expired += 1
      })
      await publishSubscriptionEntitlementReconciliation(reconciliation)
    } catch (error) {
      failed.push({ organizationId: String(dueRow.organizationId), error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { checked: due.length, expired, failed }
}

export const TenantEntitlementOverrideService = { getHistory, createOrReplace, revoke, applyDueExpirations }
