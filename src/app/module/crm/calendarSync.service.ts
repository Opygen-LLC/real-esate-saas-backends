import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Resilience } from '../../../shared/resilience'
import { userRefPopulate } from '../user/userProfile.service'
import { Viewing } from '../viewing/viewing.model'

const syncViewing = async (organizationId: string, viewingId: string) => {
  const scope = { _id: viewingId, organizationId }
  const viewing: any = await Viewing.findOne(scope)
    .populate({ path: 'propertyId', select: 'title address city', match: { organizationId } })
    .populate(userRefPopulate('agentId', 'name email', { organizationId }))
    .populate({ path: 'leadId', select: '_id', match: { organizationId } })
    .lean()

  if (!viewing) return

  // Required relationships must remain tenant-local. If a legacy/corrupt record
  // contains a cross-tenant property/agent reference, refuse to send it to the
  // calendar provider and surface a failed sync for operator reconciliation.
  if (!viewing.propertyId || !viewing.agentId) {
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'failed' } })
    logger.error('[Calendar sync] tenant relationship mismatch', { organizationId, viewingId })
    return
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
    const response = await Resilience.fetch('calendar-provider', config.calendar.sync_url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.calendar.api_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: viewing._id.toString(),
        title: `Property viewing: ${viewing.propertyId?.title || 'Property'}`,
        start: `${viewing.date}T${viewing.startTime}:00+06:00`,
        end: `${viewing.date}T${viewing.endTime}:00+06:00`,
        attendees: [viewing.agentId?.email, viewing.clientEmail].filter(Boolean),
        location: [viewing.propertyId?.address, viewing.propertyId?.city].filter(Boolean).join(', '),
        status: viewing.status,
        metadata: {
          organizationId,
          leadId: viewing.leadId?._id?.toString?.() || viewing.leadId?.toString?.(),
        },
      }),
    }, { timeoutMs: config.calendar.timeout_ms })

    const body: any = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Calendar gateway ${response.status}`)
    await Viewing.updateOne(scope, {
      $set: {
        calendarSyncStatus: 'synced',
        calendarProviderEventId: String(body.eventId || body.id || ''),
      },
    })
  } catch (error) {
    logger.error('[Calendar sync] viewing sync failed', {
      organizationId,
      viewingId,
      message: error instanceof Error ? error.message : String(error),
    })
    await Viewing.updateOne(scope, { $set: { calendarSyncStatus: 'failed' } })
    throw error
  }
}

export const CalendarSyncService = { syncViewing }
