import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Resilience } from '../../../shared/resilience'
import { Viewing } from '../viewing/viewing.model'

const syncViewing = async (viewingId: string) => {
  const viewing: any = await Viewing.findById(viewingId).populate('propertyId', 'title address city').populate('agentId', 'name email').lean()
  if (!viewing) return
  if (config.calendar.provider_approval_status !== 'approved') { await Viewing.updateOne({ _id: viewingId }, { $set: { calendarSyncStatus: 'pending_provider_approval' } }); return }
  if (!config.calendar.sync_url || !config.calendar.api_token) { await Viewing.updateOne({ _id: viewingId }, { $set: { calendarSyncStatus: 'not_configured' } }); return }
  try {
    const response = await Resilience.fetch('calendar-provider', config.calendar.sync_url, {
      method: 'POST', headers: { authorization: `Bearer ${config.calendar.api_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ externalId: viewing._id.toString(), title: `Property viewing: ${viewing.propertyId?.title || 'Property'}`, start: `${viewing.date}T${viewing.startTime}:00+06:00`, end: `${viewing.date}T${viewing.endTime}:00+06:00`, attendees: [viewing.agentId?.email, viewing.clientEmail].filter(Boolean), location: [viewing.propertyId?.address, viewing.propertyId?.city].filter(Boolean).join(', '), status: viewing.status, metadata: { organizationId: viewing.organizationId, leadId: viewing.leadId?.toString() } }),
    }, { timeoutMs: config.calendar.timeout_ms })
    const body: any = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Calendar gateway ${response.status}`)
    await Viewing.updateOne({ _id: viewingId }, { $set: { calendarSyncStatus: 'synced', calendarProviderEventId: String(body.eventId || body.id || '') } })
  } catch (error) {
    logger.error('[Calendar sync] viewing sync failed', { viewingId, message: error instanceof Error ? error.message : String(error) })
    await Viewing.updateOne({ _id: viewingId }, { $set: { calendarSyncStatus: 'failed' } })
    throw error
  }
}
export const CalendarSyncService = { syncViewing }
