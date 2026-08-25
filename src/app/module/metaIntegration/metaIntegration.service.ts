import { createHash, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { decryptField, encryptField } from '../../helpers/fieldEncryption'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { Organization } from '../organization/organization.model'
import { DomainRecord } from '../domain/domain.model'
import { MetaIntegration } from './metaIntegration.model'
import { MetaEvent } from './metaEvent.model'
import { Resilience } from '../../../shared/resilience'
import { emitProductionEvent } from '../../../shared/productionEvents'

export const META_EVENT_NAMES = ['PageView', 'ViewContent', 'Search', 'Lead', 'Contact', 'Schedule'] as const
const ALLOWED_EVENTS = new Set<string>(META_EVENT_NAMES)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeEmail = (value?: string) => value?.trim().toLowerCase() || ''
const normalizePhone = (value?: string) => value?.replace(/[^0-9]/g, '') || ''
const cleanUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    return url.toString().slice(0, 2048)
  } catch {
    throw new ApiError(400, 'Invalid canonical event URL')
  }
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

type EffectiveMetaState = {
  pixelEnabled: boolean
  capiEnabled: boolean
  capiStatus: 'not_configured' | 'active' | 'disabled' | 'error'
  accessTokenConfigured: boolean
}

const effectiveState = (integration: any): EffectiveMetaState => {
  const accessTokenConfigured = Boolean(integration?.accessTokenEncrypted)
  const legacyEnabled = integration?.status !== 'disabled'
  const pixelEnabled = typeof integration?.pixelEnabled === 'boolean' ? integration.pixelEnabled : legacyEnabled
  const capiEnabled = typeof integration?.capiEnabled === 'boolean' ? integration.capiEnabled : (legacyEnabled && accessTokenConfigured)
  const capiStatus = integration?.capiStatus
    || (!accessTokenConfigured ? 'not_configured' : !capiEnabled ? 'disabled' : integration?.status === 'error' ? 'error' : 'active')
  return { pixelEnabled, capiEnabled, capiStatus, accessTokenConfigured }
}

const serialize = (doc: any) => {
  if (!doc) return null
  const value = doc.toObject ? doc.toObject() : { ...doc }
  const state = effectiveState(value)
  delete value.accessTokenEncrypted
  return {
    ...value,
    pixelEnabled: state.pixelEnabled,
    capiEnabled: state.capiEnabled,
    capiStatus: state.capiStatus,
    accessTokenConfigured: state.accessTokenConfigured,
    supportedEvents: [...META_EVENT_NAMES],
  }
}

const fieldError = (field: string, message: string) => new ApiError(
  httpStatus.BAD_REQUEST,
  'Please correct the highlighted fields',
  '',
  'VALIDATION_ERROR',
  undefined,
  { [field]: [message] },
)

const save = async (organizationId: string, payload: any) => {
  const existing: any = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted')
  const previous = existing ? effectiveState(existing) : null
  const pixelId = String(payload.pixelId ?? existing?.pixelId ?? '').trim()
  if (!/^\d{5,30}$/.test(pixelId)) throw fieldError('pixelId', 'Pixel ID must contain 5 to 30 digits')

  const rawToken = payload.accessToken === undefined ? '' : String(payload.accessToken).trim()
  const accessTokenEncrypted = rawToken ? encryptField(rawToken) : String(existing?.accessTokenEncrypted || '')
  const accessTokenConfigured = Boolean(accessTokenEncrypted)

  const pixelEnabled = typeof payload.pixelEnabled === 'boolean'
    ? payload.pixelEnabled
    : previous?.pixelEnabled ?? true
  const capiEnabled = typeof payload.capiEnabled === 'boolean'
    ? payload.capiEnabled
    : previous?.capiEnabled ?? false

  if (capiEnabled && !accessTokenConfigured) {
    throw fieldError('accessToken', 'A Meta Conversions API access token is required before enabling CAPI')
  }

  const testEventCode = payload.testEventCode === undefined
    ? String(existing?.testEventCode || '')
    : String(payload.testEventCode || '').trim().slice(0, 100)
  const consentRequired = typeof payload.consentRequired === 'boolean'
    ? payload.consentRequired
    : existing?.consentRequired !== false
  const enableSchedule = typeof payload.enableSchedule === 'boolean'
    ? payload.enableSchedule
    : existing?.enableSchedule !== false

  let capiStatus: EffectiveMetaState['capiStatus']
  if (!accessTokenConfigured) capiStatus = 'not_configured'
  else if (!capiEnabled) capiStatus = 'disabled'
  else if (rawToken) capiStatus = 'active'
  else capiStatus = previous?.capiStatus === 'error' ? 'error' : 'active'

  const set: Record<string, unknown> = {
    pixelId,
    pixelEnabled,
    capiEnabled,
    capiStatus,
    accessTokenEncrypted,
    testEventCode,
    consentRequired,
    enableSchedule,
    // Legacy status stays usable for old app versions but no longer carries
    // CAPI error state, so a server-delivery failure cannot disable the Pixel.
    status: pixelEnabled || capiEnabled ? 'active' : 'disabled',
  }
  if (rawToken) {
    set['diagnostics.lastCapiError'] = null
  }

  const result = await MetaIntegration.findOneAndUpdate(
    { organizationId },
    { $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).select('+accessTokenEncrypted')

  if (pixelEnabled && (!previous?.pixelEnabled || String(existing?.pixelId || '') !== pixelId)) {
    emitProductionEvent('meta_pixel_configured', { organizationId, pixelEnabled: true, pixelId })
  }
  if (capiEnabled && (!previous?.capiEnabled || Boolean(rawToken))) {
    emitProductionEvent('meta_capi_configured', { organizationId, capiEnabled: true, accessTokenConfigured: true })
  }
  return serialize(result)
}

const get = async (organizationId: string) => serialize(await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted'))

const resolveOrganization = async (identifier: string) => {
  const direct = await Organization.findOne({ $or: [{ organizationId: identifier }, { sub_domain: identifier }] }).select('organizationId').lean()
  if (direct) return direct.organizationId
  const normalized = identifier.toLowerCase().replace(/^www\./, '').split(':')[0]
  const domain = await DomainRecord.findOne({ domain: normalized, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('organizationId').lean()
  return domain?.organizationId || null
}

export const resolveCanonicalMetaPublicUrl = async (organizationId: string): Promise<string> => {
  const [domain, organization] = await Promise.all([
    DomainRecord.findOne({
      organizationId,
      entitlementStatus: { $ne: 'suspended' },
      status: 'verified',
      tlsStatus: 'active',
    }).select('domain').lean(),
    Organization.findOne({ organizationId }).select('sub_domain').lean(),
  ])
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  return buildTenantWebsiteUrl(String(organization.sub_domain || organizationId), domain?.domain || null)
}

const publicConfig = async (identifier: string) => {
  const organizationId = await resolveOrganization(identifier)
  if (!organizationId) return { enabled: false, pixelEnabled: false, capiEnabled: false }
  const integration: any = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted').lean()
  if (!integration) return { enabled: false, pixelEnabled: false, capiEnabled: false }
  const state = effectiveState(integration)
  return {
    enabled: state.pixelEnabled || state.capiEnabled,
    pixelEnabled: state.pixelEnabled,
    capiEnabled: state.capiEnabled,
    pixelId: integration.pixelId,
    consentRequired: integration.consentRequired !== false,
    enableSchedule: integration.enableSchedule !== false,
  }
}

const recordBrowserDiagnostic = async (organizationId: string, payload: any, eventId: string) => {
  if (payload.browserPixelFired !== true) return
  await MetaIntegration.updateOne({ organizationId }, { $set: {
    'diagnostics.lastBrowserEvent': {
      eventName: String(payload.eventName || ''),
      eventId,
      at: new Date(),
      eventSourceUrl: cleanUrl(payload.eventSourceUrl),
    },
  } })
}

const queuePublicEvent = async (identifier: string, payload: any, context: { ip?: string; userAgent?: string }) => {
  const organizationId = await resolveOrganization(identifier)
  if (!organizationId) throw new ApiError(404, 'Agency website not found')
  const integration: any = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted').lean()
  if (!integration) return { queued: false, reason: 'integration_disabled' }

  const state = effectiveState(integration)
  if (!state.pixelEnabled && !state.capiEnabled) return { queued: false, reason: 'integration_disabled' }
  if (integration.consentRequired !== false && payload.consent !== true) return { queued: false, reason: 'consent_required' }

  const eventName = String(payload.eventName || '')
  if (!ALLOWED_EVENTS.has(eventName)) throw new ApiError(400, 'Unsupported Meta event')
  if (eventName === 'Schedule' && integration.enableSchedule === false) return { queued: false, reason: 'schedule_disabled' }

  const eventId = String(payload.eventId || randomUUID()).slice(0, 120)
  await recordBrowserDiagnostic(organizationId, payload, eventId)

  if (!state.capiEnabled) return { queued: false, reason: 'capi_disabled', eventId }
  if (!state.accessTokenConfigured) return { queued: false, reason: 'capi_not_configured', eventId }

  const userData = normalizeMetaUserData(payload.userData || {})
  try {
    const event = await MetaEvent.create({
      organizationId,
      eventName,
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      eventSourceUrl: cleanUrl(payload.eventSourceUrl),
      userData,
      clientIpEncrypted: context.ip ? encryptField(context.ip) : '',
      clientUserAgent: String(context.userAgent || '').slice(0, 1000),
      customData: payload.customData && typeof payload.customData === 'object' ? payload.customData : {},
      testEventCode: integration.testEventCode || '',
    })
    return { queued: true, eventId: event.eventId }
  } catch (error: any) {
    if (error?.code === 11000) return { queued: false, duplicate: true, eventId }
    throw error
  }
}

const markCapiError = async (organizationId: string, error: any) => {
  const errorCode = String(error?.code || 'CAPI_ERROR').slice(0, 80)
  await MetaIntegration.updateOne({ organizationId }, { $set: {
    capiStatus: 'error',
    'diagnostics.lastCapiError': {
      code: errorCode,
      message: String(error?.message || 'Meta CAPI delivery failed').slice(0, 500),
      at: new Date(),
    },
  } })
  emitProductionEvent('meta_capi_failed', { organizationId, errorCode }, 'error')
}

const sendEvent = async (event: any) => {
  const integration: any = await MetaIntegration.findOne({ organizationId: event.organizationId }).select('+accessTokenEncrypted')
  if (!integration) throw new ApiError(409, 'Meta integration is not configured')
  const state = effectiveState(integration)
  if (!state.capiEnabled) throw new ApiError(409, 'Meta Conversions API is disabled')
  if (!state.accessTokenConfigured) throw new ApiError(409, 'Meta Conversions API access token is not configured')

  const accessToken = decryptField(integration.accessTokenEncrypted)
  const userData = { ...event.userData }
  if (event.clientIpEncrypted) userData.client_ip_address = decryptField(event.clientIpEncrypted)
  if (event.clientUserAgent) userData.client_user_agent = event.clientUserAgent
  const body = buildMetaCapiBody(event, userData)

  try {
    const response = await Resilience.fetch(
      'meta-capi',
      `${config.meta.graph_base_url}/${config.meta.graph_version}/${integration.pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: config.meta.timeout_ms },
    )
    const responsePayload = parseMetaCapiResponse(response.ok, response.status, await response.json().catch(() => ({})))
    await MetaIntegration.updateOne({ organizationId: event.organizationId }, { $set: {
      capiStatus: 'active',
      lastSuccessAt: new Date(),
      'diagnostics.lastResponse': { eventsReceived: responsePayload?.events_received ?? null },
      'diagnostics.lastServerEvent': {
        eventName: event.eventName,
        eventId: event.eventId,
        at: new Date(),
        eventSourceUrl: event.eventSourceUrl,
      },
      'diagnostics.lastCapiError': null,
      'diagnostics.updatedAt': new Date(),
    } })
    return responsePayload
  } catch (error) {
    await markCapiError(event.organizationId, error)
    throw error
  }
}

const processOne = async (event: any, alreadyClaimed = false) => {
  if (!alreadyClaimed) {
    event.status = 'processing'
    event.attempts += 1
    event.processingStartedAt = new Date()
    await event.save()
  }
  try {
    await sendEvent(event)
    event.status = 'sent'
    event.sentAt = new Date()
    event.lastErrorCode = ''
    event.lastErrorMessage = ''
    await event.save()
    return true
  } catch (error: any) {
    event.lastErrorCode = String(error?.code || 'CAPI_ERROR').slice(0, 80)
    event.lastErrorMessage = String(error?.message || 'Meta CAPI delivery failed').slice(0, 500)
    if (event.attempts >= config.meta.max_attempts) event.status = 'dead'
    else {
      event.status = 'queued'
      event.nextAttemptAt = new Date(Date.now() + metaRetryDelayMs(event.attempts))
    }
    await event.save()
    return false
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
  await MetaEvent.updateMany({ status: 'processing', processingStartedAt: { $lte: new Date(Date.now() - 10 * 60_000) } }, { $set: { status: 'queued', nextAttemptAt: new Date() } })
  let processed = 0
  let sent = 0
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

const test = async (organizationId: string) => {
  const integration: any = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted')
  if (!integration) throw new ApiError(404, 'Meta integration is not connected')
  const state = effectiveState(integration)
  if (!state.capiEnabled) throw new ApiError(409, 'Enable Conversions API before sending a test event')
  if (!state.accessTokenConfigured) throw fieldError('accessToken', 'Configure a Meta Conversions API access token before testing')

  const eventSourceUrl = cleanUrl(await resolveCanonicalMetaPublicUrl(organizationId))
  const event = await MetaEvent.create({
    organizationId,
    eventName: 'PageView',
    eventId: `test_${randomUUID()}`,
    eventTime: Math.floor(Date.now() / 1000),
    eventSourceUrl,
    userData: {},
    customData: { integration_test: true },
    testEventCode: integration.testEventCode || '',
    status: 'queued',
  })
  const ok = await processOne(event)
  const lastTest = { ok, at: new Date(), error: ok ? '' : event.lastErrorMessage, eventSourceUrl }
  await MetaIntegration.updateOne({ organizationId }, { $set: { lastTestAt: lastTest.at, 'diagnostics.lastTest': lastTest } })
  return { ok, eventId: event.eventId, eventSourceUrl, diagnostics: lastTest }
}

const diagnostics = async (organizationId: string) => {
  const integration: any = await MetaIntegration.findOne({ organizationId }).select('+accessTokenEncrypted').lean()
  const publicUrl = await resolveCanonicalMetaPublicUrl(organizationId)
  if (!integration) {
    return {
      pixel: { enabled: false, connected: false, pixelId: '' },
      capi: { enabled: false, status: 'not_configured', accessTokenConfigured: false },
      publicUrl,
      supportedEvents: [...META_EVENT_NAMES],
      lastBrowserEvent: null,
      lastServerEvent: null,
      lastSuccessfulCapiAt: null,
      queue: 0,
      deadLetters: 0,
    }
  }

  const state = effectiveState(integration)
  const [queue, deadLetters, lastSent] = await Promise.all([
    MetaEvent.countDocuments({ organizationId, status: { $in: ['queued', 'processing'] } }),
    MetaEvent.countDocuments({ organizationId, status: 'dead' }),
    MetaEvent.findOne({ organizationId, status: 'sent' }).select('eventName eventId eventSourceUrl sentAt').sort({ sentAt: -1, _id: -1 }).lean(),
  ])
  const diagnosticsValue = integration.diagnostics || {}
  return {
    pixel: { enabled: state.pixelEnabled, connected: state.pixelEnabled && Boolean(integration.pixelId), pixelId: integration.pixelId || '' },
    capi: {
      enabled: state.capiEnabled,
      status: state.capiStatus,
      accessTokenConfigured: state.accessTokenConfigured,
      lastError: diagnosticsValue.lastCapiError || null,
      lastTestAt: integration.lastTestAt || null,
    },
    publicUrl,
    supportedEvents: [...META_EVENT_NAMES],
    lastBrowserEvent: diagnosticsValue.lastBrowserEvent || null,
    lastServerEvent: diagnosticsValue.lastServerEvent || (lastSent ? {
      eventName: lastSent.eventName,
      eventId: lastSent.eventId,
      at: lastSent.sentAt,
      eventSourceUrl: lastSent.eventSourceUrl,
    } : null),
    lastSuccessfulCapiAt: integration.lastSuccessAt || null,
    queue,
    deadLetters,
  }
}

const deadLetters = async (organizationId: string) => MetaEvent.find({ organizationId, status: 'dead' }).select('eventName eventId attempts lastErrorCode lastErrorMessage createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean()
const retryDeadLetter = async (organizationId: string, id: string) => MetaEvent.findOneAndUpdate({ _id: id, organizationId, status: 'dead' }, { $set: { status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastErrorCode: '', lastErrorMessage: '' } }, { new: true }).select('eventName eventId status attempts')

export const MetaIntegrationService = { save, get, publicConfig, queuePublicEvent, processById, processQueue, test, diagnostics, deadLetters, retryDeadLetter }
