import { createHash, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { decryptField, encryptField } from '../../helpers/fieldEncryption'
import { Organization } from '../organization/organization.model'
import { DomainRecord } from '../domain/domain.model'
import { MetaIntegration } from './metaIntegration.model'
import { MetaEvent } from './metaEvent.model'
import { Resilience } from '../../../shared/resilience'

const ALLOWED_EVENTS = new Set(['PageView', 'ViewContent', 'Search', 'Lead', 'Contact', 'Schedule'])
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeEmail = (value?: string) => value?.trim().toLowerCase() || ''
const normalizePhone = (value?: string) => value?.replace(/[^0-9]/g, '') || ''
const cleanUrl = (value: string) => {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); return url.toString().slice(0, 2048) } catch { throw new ApiError(400, 'Invalid canonical event URL') }
}

export const normalizeMetaUserData = (input: Record<string, any> = {}) => {
  const email = normalizeEmail(input.email)
  const phone = normalizePhone(input.phone)
  const firstName = String(input.firstName || '').trim().toLowerCase()
  const lastName = String(input.lastName || '').trim().toLowerCase()
  const userData: Record<string, any> = {}
  if (email) userData.em = [sha(email)]
  if (phone) userData.ph = [sha(phone)]
  if (firstName) userData.fn = [sha(firstName)]
  if (lastName) userData.ln = [sha(lastName)]
  if (input.fbp) userData.fbp = String(input.fbp).slice(0, 255)
  if (input.fbc) userData.fbc = String(input.fbc).slice(0, 255)
  return userData
}

export const buildMetaCapiBody = (event: any, userData: Record<string, any>) => {
  const body: any = { data: [{
    event_name: event.eventName,
    event_time: event.eventTime,
    event_id: event.eventId,
    action_source: 'website',
    event_source_url: event.eventSourceUrl,
    user_data: userData,
    custom_data: event.customData || {},
  }] }
  if (event.testEventCode) body.test_event_code = event.testEventCode
  return body
}

export const metaRetryDelayMs = (attempts: number): number => Math.min(6 * 60 * 60_000, 2 ** Math.max(0, attempts) * 30_000)

export const parseMetaCapiResponse = (ok: boolean, status: number, payload: any) => {
  if (!ok || payload?.error) {
    const code = String(payload?.error?.code || status)
    const message = String(payload?.error?.message || `Meta CAPI HTTP ${status}`).slice(0, 500)
    const error = new Error(message) as Error & { code?: string }
    error.code = code
    throw error
  }
  return payload
}

const serialize = (doc: any) => {
  if (!doc) return null
  const value = doc.toObject ? doc.toObject() : { ...doc }
  delete value.accessTokenEncrypted
  return { ...value, accessTokenConfigured: true }
}

const save = async (organizationId: string, payload: any) => {
  const pixelId = String(payload.pixelId || '').trim()
  if (!/^\d{5,30}$/.test(pixelId)) throw new ApiError(400, 'Pixel ID must contain digits only')
  const existing = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted')
  const token = String(payload.accessToken || '').trim()
  if (!existing && !token) throw new ApiError(400, 'Meta access token is required when connecting the integration')
  const accessTokenEncrypted = token ? encryptField(token) : existing!.accessTokenEncrypted
  const result = await MetaIntegration.findOneAndUpdate({ organizationId }, { $set: {
    pixelId, accessTokenEncrypted, testEventCode: String(payload.testEventCode || '').trim().slice(0, 100),
    status: payload.status === 'disabled' ? 'disabled' : 'active', consentRequired: payload.consentRequired !== false,
    enableSchedule: payload.enableSchedule !== false,
  } }, { new: true, upsert: true, setDefaultsOnInsert: true })
  return serialize(result)
}

const get = async (organizationId: string) => serialize(await MetaIntegration.findOne({ organizationId }))

const resolveOrganization = async (identifier: string) => {
  const direct = await Organization.findOne({ $or: [{ organizationId: identifier }, { sub_domain: identifier }] }).select('organizationId').lean()
  if (direct) return direct.organizationId
  const normalized = identifier.toLowerCase().replace(/^www\./, '').split(':')[0]
  const domain = await DomainRecord.findOne({ domain: normalized, status: 'verified', tlsStatus: 'active' }).select('organizationId').lean()
  return domain?.organizationId || null
}

const publicConfig = async (identifier: string) => {
  const organizationId = await resolveOrganization(identifier)
  if (!organizationId) return { enabled: false }
  const integration = await MetaIntegration.findOne({ organizationId, status: 'active' }).lean()
  if (!integration) return { enabled: false }
  return { enabled: true, pixelId: integration.pixelId, consentRequired: integration.consentRequired, enableSchedule: integration.enableSchedule }
}

const queuePublicEvent = async (identifier: string, payload: any, context: { ip?: string; userAgent?: string }) => {
  const organizationId = await resolveOrganization(identifier)
  if (!organizationId) throw new ApiError(404, 'Agency website not found')
  const integration = await MetaIntegration.findOne({ organizationId, status: 'active' }).lean()
  if (!integration) return { queued: false, reason: 'integration_disabled' }
  if (integration.consentRequired && payload.consent !== true) return { queued: false, reason: 'consent_required' }
  const eventName = String(payload.eventName || '')
  if (!ALLOWED_EVENTS.has(eventName)) throw new ApiError(400, 'Unsupported Meta event')
  if (eventName === 'Schedule' && !integration.enableSchedule) return { queued: false, reason: 'schedule_disabled' }

  const eventId = String(payload.eventId || randomUUID()).slice(0, 120)
  const userData = normalizeMetaUserData(payload.userData || {})

  try {
    const event = await MetaEvent.create({
      organizationId, eventName, eventId, eventTime: Math.floor(Date.now() / 1000), eventSourceUrl: cleanUrl(payload.eventSourceUrl),
      userData, clientIpEncrypted: context.ip ? encryptField(context.ip) : '', clientUserAgent: String(context.userAgent || '').slice(0, 1000),
      customData: payload.customData && typeof payload.customData === 'object' ? payload.customData : {}, testEventCode: integration.testEventCode || '',
    })
    return { queued: true, eventId: event.eventId }
  } catch (error: any) {
    if (error?.code === 11000) return { queued: false, duplicate: true, eventId }
    throw error
  }
}

const sendEvent = async (event: any) => {
  const integration = await MetaIntegration.findOne({ organizationId: event.organizationId }).select('+accessTokenEncrypted')
  if (!integration || integration.status === 'disabled') throw new ApiError(409, 'Meta integration is disabled')
  const accessToken = decryptField(integration.accessTokenEncrypted)
  const userData = { ...event.userData }
  if (event.clientIpEncrypted) userData.client_ip_address = decryptField(event.clientIpEncrypted)
  if (event.clientUserAgent) userData.client_user_agent = event.clientUserAgent
  const body = buildMetaCapiBody(event, userData)
  const response = await Resilience.fetch('meta-capi', `${config.meta.graph_base_url}/${config.meta.graph_version}/${integration.pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { timeoutMs: config.meta.timeout_ms })
  const responsePayload = parseMetaCapiResponse(response.ok, response.status, await response.json().catch(() => ({})))
  integration.lastSuccessAt = new Date(); integration.diagnostics = { lastResponse: { eventsReceived: responsePayload?.events_received ?? null }, updatedAt: new Date() }
  await integration.save()
  return responsePayload
}

const processOne = async (event: any, alreadyClaimed = false) => {
  if (!alreadyClaimed) { event.status = 'processing'; event.attempts += 1; event.processingStartedAt = new Date(); await event.save() }
  try {
    await sendEvent(event)
    event.status = 'sent'; event.sentAt = new Date(); event.lastErrorCode = ''; event.lastErrorMessage = ''; await event.save()
    return true
  } catch (error: any) {
    event.lastErrorCode = String(error?.code || 'CAPI_ERROR').slice(0, 80)
    event.lastErrorMessage = String(error?.message || 'Meta CAPI delivery failed').slice(0, 500)
    if (event.attempts >= config.meta.max_attempts) event.status = 'dead'
    else { event.status = 'queued'; event.nextAttemptAt = new Date(Date.now() + metaRetryDelayMs(event.attempts)) }
    await event.save(); return false
  }
}


const processById = async (eventId: string) => {
  const event: any = await MetaEvent.findById(eventId)
  if (!event || event.status === 'sent') return { sent: Boolean(event) }
  if (event.status === 'dead') throw new Error('Meta event is in dead-letter state')
  const ok = await processOne(event)
  if (!ok) throw new Error(event.lastErrorMessage || 'Meta CAPI delivery failed')
  return { sent: true }
}

const processQueue = async (limit = 50) => {
  // Recover events abandoned by a crashed worker, then atomically claim one job
  // at a time so multiple API replicas cannot deliver the same CAPI job.
  await MetaEvent.updateMany({ status: 'processing', processingStartedAt: { $lte: new Date(Date.now() - 10 * 60_000) } }, { $set: { status: 'queued', nextAttemptAt: new Date() } })
  let processed = 0; let sent = 0
  while (processed < limit) {
    const event = await MetaEvent.findOneAndUpdate(
      { status: 'queued', nextAttemptAt: { $lte: new Date() } },
      { $set: { status: 'processing', processingStartedAt: new Date() }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, new: true },
    )
    if (!event) break
    processed += 1
    if (await processOne(event, true)) sent += 1
  }
  return { processed, sent, failed: processed - sent }
}

const test = async (organizationId: string, sourceUrl: string) => {
  const integration = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted')
  if (!integration) throw new ApiError(404, 'Meta integration is not connected')
  const event = await MetaEvent.create({ organizationId, eventName: 'PageView', eventId: `test_${randomUUID()}`, eventTime: Math.floor(Date.now()/1000), eventSourceUrl: cleanUrl(sourceUrl), userData: {}, customData: { integration_test: true }, testEventCode: integration.testEventCode || '', status: 'queued' })
  const ok = await processOne(event)
  integration.lastTestAt = new Date(); integration.status = ok ? 'active' : 'error'; integration.diagnostics = { ...(integration.diagnostics || {}), lastTest: { ok, at: new Date(), error: ok ? '' : event.lastErrorMessage } }; await integration.save()
  return { ok, eventId: event.eventId, diagnostics: integration.diagnostics }
}

const deadLetters = async (organizationId: string) => MetaEvent.find({ organizationId, status: 'dead' }).select('eventName eventId attempts lastErrorCode lastErrorMessage createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean()
const retryDeadLetter = async (organizationId: string, id: string) => MetaEvent.findOneAndUpdate({ _id: id, organizationId, status: 'dead' }, { $set: { status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastErrorCode: '', lastErrorMessage: '' } }, { new: true }).select('eventName eventId status attempts')

export const MetaIntegrationService = { save, get, publicConfig, queuePublicEvent, processById, processQueue, test, deadLetters, retryDeadLetter }
