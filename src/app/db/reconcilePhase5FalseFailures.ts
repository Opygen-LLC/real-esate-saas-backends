import mongoose from 'mongoose'
import config from '../../config'
import { Activity } from '../module/activity/activity.model'
import { AuditEvent } from '../module/audit/audit.model'
import { DomainEvent } from '../module/domainEvent/domainEvent.model'
import { DomainEventService } from '../module/domainEvent/domainEvent.service'
import { EntitlementService } from '../module/entitlement/entitlement.service'
import { Lead } from '../module/lead/lead.model'
import { LEAD_STATUS } from '../module/lead/leadStatus.contract'
import { Organization } from '../module/organization/organization.model'
import { Viewing } from '../module/viewing/viewing.model'
import { migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { mongoSupportsTransactions } from './mongoCapabilities'

const MIGRATION = 'phase5-false-failure-reconciliation'
const CONFIRMATION = 'PHASE5-FALSE-FAILURE-REPAIR'
const VIEWING_EVENT_TYPES = ['viewing.updated', 'viewing.completed'] as const
const EVENT_MATCH_WINDOW_MS = 30_000
const MAX_SCAN = 10_000

const optionValue = (name: string): string | undefined => {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

const parseDate = (value: string | undefined, fallback: Date): Date => {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid --since value: ${value}`)
  return parsed
}

const requestedOrganizationId = optionValue('organization-id')?.trim()
const requestIds = (optionValue('request-ids') || process.env.PHASE5_AFFECTED_REQUEST_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const since = parseDate(optionValue('since'), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
const requestedLimit = Number(optionValue('limit') || 5000)
const limit = Math.max(1, Math.min(MAX_SCAN, Number.isFinite(requestedLimit) ? requestedLimit : 5000))

const reconciliationKey = (viewing: any): string =>
  `phase5:viewing:${String(viewing._id)}:${new Date(viewing.updatedAt).toISOString()}`

const expectedEventType = (viewing: any): 'viewing.updated' | 'viewing.completed' =>
  viewing.status === 'Completed' ? 'viewing.completed' : 'viewing.updated'

const eventNearLatestMutation = async (viewing: any) => {
  const updatedAt = new Date(viewing.updatedAt)
  return DomainEvent.findOne({
    organizationId: viewing.organizationId,
    aggregateType: 'viewing',
    aggregateId: String(viewing._id),
    eventType: { $in: [...VIEWING_EVENT_TYPES] },
    $or: [
      { occurredAt: { $gte: new Date(updatedAt.getTime() - EVENT_MATCH_WINDOW_MS) } },
      { 'payload.reconciliationKey': reconciliationKey(viewing) },
    ],
  }).sort({ occurredAt: -1, _id: -1 }).lean()
}

const activityForEvent = async (organizationId: string, eventId: unknown) => Activity.findOne({
  organizationId,
  'metadata.domainEventId': eventId,
}).select('_id').lean()

const scanTrialFalseFailures = async () => {
  const auditFilter: Record<string, unknown> = {
    action: 'subscription.trial_updated',
    createdAt: { $gte: since },
    ...(requestedOrganizationId ? { organizationId: requestedOrganizationId } : {}),
    ...(requestIds.length ? { requestId: { $in: requestIds } } : {}),
  }
  const audits: any[] = await AuditEvent.find(auditFilter)
    .select('organizationId requestId action reason metadata createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean()

  const organizations = [...new Set(audits.map((row) => String(row.organizationId)).filter(Boolean))]
  const quotaRisks: Array<Record<string, unknown>> = []
  const committedTrialActions: Array<Record<string, unknown>> = []

  for (const organizationId of organizations) {
    const organization: any = await Organization.findOne({ organizationId }).select('subscription').lean()
    if (!organization) {
      quotaRisks.push({ organizationId, reason: 'organization_missing_after_trial_audit' })
      continue
    }

    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    if (quota.teamMembersCommitted > quota.maxTeamMembers) {
      quotaRisks.push({
        organizationId,
        reason: 'team_members_above_effective_quota',
        teamMembersCommitted: quota.teamMembersCommitted,
        maxTeamMembers: quota.maxTeamMembers,
      })
    }

    const end = organization.subscription?.trialEndsAt ? new Date(organization.subscription.trialEndsAt) : null
    if (organization.subscription?.status === 'trialing' && end && end.getTime() <= Date.now()) {
      quotaRisks.push({ organizationId, reason: 'trialing_subscription_has_past_end', trialEndsAt: end.toISOString() })
    }
  }

  for (const audit of audits) {
    committedTrialActions.push({
      organizationId: audit.organizationId,
      requestId: audit.requestId || '',
      action: audit.metadata?.action || 'unknown',
      createdAt: audit.createdAt,
      reason: audit.reason || '',
      note: 'Audit row exists, so the old false-500 request may already have committed. Do not replay it blindly.',
    })
  }

  return { committedTrialActions, quotaRisks }
}

const scanViewings = async () => {
  const candidates: any[] = await Viewing.find({
    updatedAt: { $gte: since },
    leadId: { $exists: true, $ne: null },
    ...(requestedOrganizationId ? { organizationId: requestedOrganizationId } : {}),
  })
    .select('_id organizationId leadId propertyId agentId date startTime endTime status createdAt updatedAt')
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit)
    .lean()

  const missingEvents: Array<Record<string, unknown>> = []
  const missingActivities: Array<Record<string, unknown>> = []
  const relationshipRisks: Array<Record<string, unknown>> = []

  for (const viewing of candidates) {
    const createdAt = new Date(viewing.createdAt)
    const updatedAt = new Date(viewing.updatedAt)
    const looksMutated = updatedAt.getTime() - createdAt.getTime() > 1000 || viewing.status !== 'Scheduled'
    if (!looksMutated) continue

    const lead: any = await Lead.findOne({ _id: viewing.leadId, organizationId: viewing.organizationId })
      .select('_id leadStatus')
      .lean()
    if (!lead) {
      relationshipRisks.push({
        viewingId: String(viewing._id),
        organizationId: viewing.organizationId,
        leadId: String(viewing.leadId),
        reason: 'linked_lead_missing',
      })
      continue
    }

    if (viewing.status === 'Completed' && lead.leadStatus !== LEAD_STATUS.VIEWING_COMPLETED) {
      relationshipRisks.push({
        viewingId: String(viewing._id),
        organizationId: viewing.organizationId,
        leadId: String(lead._id),
        reason: 'completed_viewing_lead_lifecycle_mismatch',
        leadStatus: lead.leadStatus,
      })
    }

    const event: any = await eventNearLatestMutation(viewing)
    if (!event) {
      missingEvents.push({
        viewingId: String(viewing._id),
        organizationId: viewing.organizationId,
        leadId: String(viewing.leadId),
        status: viewing.status,
        updatedAt: viewing.updatedAt,
        expectedEventType: expectedEventType(viewing),
        reconciliationKey: reconciliationKey(viewing),
      })
      continue
    }

    if (!await activityForEvent(viewing.organizationId, event._id)) {
      missingActivities.push({
        viewingId: String(viewing._id),
        organizationId: viewing.organizationId,
        eventId: String(event._id),
        eventType: event.eventType,
        leadId: String(viewing.leadId),
      })
    }
  }

  return { candidates, missingEvents, missingActivities, relationshipRisks }
}

const repairViewing = async (viewingId: string) => {
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      const viewing: any = await Viewing.findById(viewingId)
        .select('_id organizationId leadId propertyId agentId date startTime status createdAt updatedAt')
        .session(session)
        .lean()
      if (!viewing?.leadId) return

      const key = reconciliationKey(viewing)
      const updatedAt = new Date(viewing.updatedAt)
      const existingEvent: any = await DomainEvent.findOne({
        organizationId: viewing.organizationId,
        aggregateType: 'viewing',
        aggregateId: String(viewing._id),
        eventType: { $in: [...VIEWING_EVENT_TYPES] },
        $or: [
          { occurredAt: { $gte: new Date(updatedAt.getTime() - EVENT_MATCH_WINDOW_MS) } },
          { 'payload.reconciliationKey': key },
        ],
      }).session(session)

      if (!existingEvent) {
        await DomainEventService.emit({
          organizationId: viewing.organizationId,
          aggregateType: 'viewing',
          aggregateId: String(viewing._id),
          eventType: expectedEventType(viewing),
          leadId: String(viewing.leadId),
          propertyId: viewing.propertyId ? String(viewing.propertyId) : undefined,
          actorId: viewing.agentId ? String(viewing.agentId) : undefined,
          requestId: key,
          payload: {
            summary: `Reconciled viewing ${viewing.status} for ${viewing.date} at ${viewing.startTime}`,
            status: viewing.status,
            reconciled: true,
            reconciliationKey: key,
            originalUpdatedAt: updatedAt.toISOString(),
          },
        }, { session, deferPublish: true })
        return
      }

      const existingActivity = await Activity.findOne({
        organizationId: viewing.organizationId,
        'metadata.domainEventId': existingEvent._id,
      }).session(session)
      if (existingActivity) return

      const title = existingEvent.eventType === 'viewing.completed' ? 'Viewing completed' : 'Viewing updated'
      await Activity.create([{
        organizationId: viewing.organizationId,
        leadId: viewing.leadId,
        propertyId: viewing.propertyId,
        agentId: viewing.agentId,
        type: 'viewing',
        title,
        content: `Reconciled CRM history for ${viewing.date} at ${viewing.startTime}`,
        metadata: {
          domainEventId: existingEvent._id,
          eventType: existingEvent.eventType,
          migrationKey: `${key}:activity:${String(existingEvent._id)}`,
          reconciled: true,
        },
      }], { session })
    })
  } finally {
    await session.endSession()
  }
}

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)

  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const viewingScan = await scanViewings()
  const trialScan = await scanTrialFalseFailures()
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} since=${since.toISOString()} candidates=${viewingScan.candidates.length}`)
  console.log(`[${MIGRATION}] missingViewingEvents=${viewingScan.missingEvents.length} missingViewingActivities=${viewingScan.missingActivities.length} relationshipRisks=${viewingScan.relationshipRisks.length}`)
  console.log(`[${MIGRATION}] committedTrialActions=${trialScan.committedTrialActions.length} quotaRisks=${trialScan.quotaRisks.length}`)

  let repaired = 0
  if (cli.apply) {
    if (!await mongoSupportsTransactions()) {
      throw new Error('Phase 5 reconciliation requires a MongoDB replica set or mongos so additive repairs are atomic')
    }
    const ids = [...new Set([
      ...viewingScan.missingEvents.map((row) => String(row.viewingId)),
      ...viewingScan.missingActivities.map((row) => String(row.viewingId)),
    ])]
    for (const viewingId of ids) {
      await repairViewing(viewingId)
      repaired += 1
    }
  } else {
    console.log(`[${MIGRATION}] No records changed. Review the manifest, then use --apply --confirm=${CONFIRMATION}.`)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    mode: cli.apply ? 'apply' : 'dry-run',
    since: since.toISOString(),
    organizationId: requestedOrganizationId || null,
    requestIds,
    scannedViewings: viewingScan.candidates.length,
    missingEvents: viewingScan.missingEvents,
    missingActivities: viewingScan.missingActivities,
    relationshipRisks: viewingScan.relationshipRisks,
    committedTrialActions: trialScan.committedTrialActions,
    quotaRisks: trialScan.quotaRisks,
    repairedViewingRecords: repaired,
    safety: {
      mutatesExistingViewing: false,
      mutatesExistingLead: false,
      mutatesSubscription: false,
      replaysRequests: false,
      publishesExternalSideEffects: false,
      additiveRepairsOnly: true,
    },
  })
  console.log(`[${MIGRATION}] manifest=${manifest}`)

  if (viewingScan.relationshipRisks.length || trialScan.quotaRisks.length) {
    console.error(`[${MIGRATION}] Manual review required for ${viewingScan.relationshipRisks.length + trialScan.quotaRisks.length} non-additive consistency risk(s). No automatic business-state change was performed.`)
    process.exitCode = 2
  }
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
