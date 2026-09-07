import { createHash } from 'crypto'
import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Resilience } from '../../../shared/resilience'
import { userRefPopulate } from '../user/userProfile.service'
import { Viewing } from '../viewing/viewing.model'

const deliveryKey = (organizationId: string, viewingId: string, revision: number) =>
  createHash('sha256').update(JSON.stringify(['viewing-calendar-v1', organizationId, viewingId, revision])).digest('hex')

/**
 * The gateway must deduplicate Idempotency-Key and atomically reject a revision
 * older than its stored (organizationId, externalId) revision. A revision is also
 * sent in the body because a timed-out request may still finish remotely.
 */
const send = async (organizationId: string, viewingId: string, revision: number, payload: Record<string, unknown>) => {
  const response = await Resilience.fetch('calendar-provider', config.calendar.sync_url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.calendar.api_token}`,
      'content-type': 'application/json',
      'Idempotency-Key': deliveryKey(organizationId, viewingId, revision),
    },
    body: JSON.stringify({ ...payload, externalId: viewingId, organizationId, revision }),
  }, { timeoutMs: config.calendar.timeout_ms })
  const body: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Calendar gateway ${response.status}`)
  return body
}

const syncViewing = async (organizationId: string, viewingId: string, expectedVersion?: number) => {
  const baseScope = { _id: viewingId, organizationId }
  const viewing: any = await Viewing.findOne(baseScope)
    .populate({ path: 'propertyId', select: 'title address city', match: { organizationId } })
    .populate(userRefPopulate('agentId', 'name email', { organizationId }))
    .populate({ path: 'leadId', select: '_id', match: { organizationId } })
    .lean()
  if (!viewing) return
  const version = Number(viewing.scheduleVersion || 1)
  if (expectedVersion !== undefined && Number(expectedVersion) !== version) return
  // Do not acknowledge an obsolete provider result against a newer schedule.
  const scope = { ...baseScope, $or: [{ scheduleVersion: version }, ...(version === 1 ? [{ scheduleVersion: { $exists: false } }] : [])] }
  if (!viewing.propertyId || !viewing.agentId) {
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'failed' } })
    throw new Error('Calendar sync refused a missing or cross-tenant relationship')
  }
  if (config.calendar.provider_approval_status !== 'approved') {
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'pending_provider_approval' } })
    return
  }
  if (!config.calendar.sync_url || !config.calendar.api_token) {
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'not_configured' } })
    return
  }
  try {
    const body = await send(organizationId, viewingId, version, {
      action: 'upsert',
      title: `Property viewing: ${viewing.propertyId.title || 'Property'}`,
      start: `${viewing.date}T${viewing.startTime}:00+06:00`,
      end: `${viewing.date}T${viewing.endTime}:00+06:00`,
      attendees: [viewing.agentId.email, viewing.clientEmail].filter(Boolean),
      location: [viewing.propertyId.address, viewing.propertyId.city].filter(Boolean).join(', '),
      status: viewing.status,
      metadata: { organizationId, leadId: viewing.leadId?._id?.toString?.() || viewing.leadId?.toString?.() },
    })
    await Viewing.updateOne(scope, { $set: {
      calendarSyncStatus: 'synced', calendarProviderEventId: String(body.eventId || body.id || ''),
    } })
  } catch (error) {
    logger.error('[Calendar sync] viewing sync failed', { organizationId, viewingId, message: error instanceof Error ? error.message : String(error) })
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'failed' } })
    throw error
  }
}

const deleteViewing = async (organizationId: string, viewingId: string, revision: number, providerEventId = '') => {
  // A tombstone must not be discarded merely because a provider is temporarily
  // unavailable. Exhausted jobs remain failed and visible for an explicit retry.
  if (config.calendar.provider_approval_status !== 'approved' || !config.calendar.sync_url || !config.calendar.api_token) {
    throw new Error('Calendar cancellation is waiting for provider configuration')
  }
  await send(organizationId, viewingId, revision, { action: 'delete', status: 'Cancelled', providerEventId, metadata: { organizationId } })
}

export const CalendarSyncService = { syncViewing, deleteViewing }
