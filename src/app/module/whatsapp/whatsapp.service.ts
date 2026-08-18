import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Resilience } from '../../../shared/resilience'
import { decryptField, encryptField } from '../../helpers/fieldEncryption'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { LeadService } from '../lead/lead.service'
import { LeadLifecycleService } from '../lead/leadLifecycle.service'
import type { CrmAccessContext } from '../crm/crmAccess'
import { WhatsAppIntegration } from './whatsapp.model'

const publicShape = (doc: any) => ({ organizationId: doc.organizationId, status: doc.status, businessAccountId: doc.businessAccountId, phoneNumberId: doc.phoneNumberId, displayPhoneNumber: doc.displayPhoneNumber, hasAccessToken: Boolean(doc.encryptedAccessToken), lastTestAt: doc.lastTestAt, lastError: doc.lastError, diagnostics: doc.diagnostics || {}, updatedAt: doc.updatedAt })
const get = async (organizationId: string) => { const doc: any = await WhatsAppIntegration.findOne({ organizationId }).select('+encryptedAccessToken').lean(); return doc ? publicShape(doc) : { organizationId, status: 'disabled', hasAccessToken: false } }

const verify = async (organizationId: string) => {
  await EntitlementService.assertFeature(organizationId, 'whatsAppAutomation')
  const doc: any = await WhatsAppIntegration.findOne({ organizationId }).select('+encryptedAccessToken')
  if (!doc?.phoneNumberId || !doc?.encryptedAccessToken) throw new ApiError(409, 'Phone number ID and access token are required before verification')
  const token = decryptField(doc.encryptedAccessToken)
  const response = await Resilience.fetch('whatsapp', `${config.meta.graph_base_url}/${config.meta.graph_version}/${doc.phoneNumberId}?fields=id,display_phone_number,verified_name`, { headers: { authorization: `Bearer ${token}` } }, { timeoutMs: config.meta.timeout_ms })
  const body: any = await response.json().catch(() => ({}))
  const testedAt = new Date()
  if (!response.ok || !body?.id) {
    await WhatsAppIntegration.updateOne({ _id: doc._id }, { $set: { status: 'error', lastTestAt: testedAt, lastError: `Graph API ${response.status}`, diagnostics: { code: body?.error?.code, type: body?.error?.type } } })
    throw new ApiError(502, 'WhatsApp credentials could not be verified with Meta')
  }
  doc.status = 'connected'
  doc.lastTestAt = testedAt
  doc.lastError = ''
  doc.displayPhoneNumber = body.display_phone_number || doc.displayPhoneNumber || ''
  doc.diagnostics = { verifiedName: body.verified_name || '', providerPhoneNumberId: String(body.id) }
  await doc.save()
  return publicShape(doc)
}

const save = async (organizationId: string, payload: any) => {
  await EntitlementService.assertFeature(organizationId, 'whatsAppAutomation')
  const requestedStatus = payload.status || 'pending_approval'
  const $set: any = { businessAccountId: payload.businessAccountId || '', phoneNumberId: payload.phoneNumberId || '', displayPhoneNumber: payload.displayPhoneNumber || '', status: requestedStatus === 'disabled' ? 'disabled' : 'pending_approval', lastError: '' }
  if (payload.accessToken) $set.encryptedAccessToken = encryptField(payload.accessToken)
  const doc: any = await WhatsAppIntegration.findOneAndUpdate({ organizationId }, { $set, $setOnInsert: { organizationId } }, { new: true, upsert: true }).select('+encryptedAccessToken')
  if (requestedStatus === 'connected') return verify(organizationId)
  return publicShape(doc)
}
const disable = async (organizationId: string) => { const doc: any = await WhatsAppIntegration.findOneAndUpdate({ organizationId }, { $set: { status: 'disabled', lastError: '', diagnostics: {} }, $unset: { encryptedAccessToken: 1 } }, { new: true }).select('+encryptedAccessToken'); return doc ? publicShape(doc) : { organizationId, status: 'disabled', hasAccessToken: false } }
const deepLink = (phoneRaw: string, text?: string) => { const phone = normalizeBangladeshPhone(phoneRaw).replace(/^\+/, ''); return `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}` }
const sendTemplate = async (organizationId: string, input: { phone: string; templateName: string; languageCode?: string; components?: any[]; leadId?: string; actorId?: string }, access?: CrmAccessContext) => {
  if (input.leadId && access) {
    // Team visibility is read-only; outbound WhatsApp for a Lead requires ownership.
    await LeadService.getLeadById(organizationId, input.leadId, access)
  }
  await EntitlementService.assertFeature(organizationId, 'whatsAppAutomation')
  const integration: any = await WhatsAppIntegration.findOne({ organizationId }).select('+encryptedAccessToken')
  if (!integration || integration.status !== 'connected' || !integration.phoneNumberId || !integration.encryptedAccessToken) throw new ApiError(409, 'Official WhatsApp Business integration is not connected')
  const token = decryptField(integration.encryptedAccessToken)
  const phone = normalizeBangladeshPhone(input.phone).replace(/^\+/, '')
  const response = await Resilience.fetch('whatsapp', `${config.meta.graph_base_url}/${config.meta.graph_version}/${integration.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: input.templateName, language: { code: input.languageCode || 'en' }, ...(input.components?.length ? { components: input.components } : {}) } }) }, { timeoutMs: config.meta.timeout_ms })
  const body: any = await response.json().catch(() => ({}))
  if (!response.ok) { await WhatsAppIntegration.updateOne({ _id: integration._id }, { $set: { status: 'error', lastError: `Graph API ${response.status}`, lastTestAt: new Date() } }); throw new ApiError(502, 'WhatsApp Business provider rejected the message') }
  await WhatsAppIntegration.updateOne({ _id: integration._id }, { $set: { status: 'connected', lastError: '', lastTestAt: new Date() } })
  if (input.leadId && input.actorId) await LeadLifecycleService.recordContact(organizationId, input.leadId, { actorId: input.actorId, channel: 'whatsapp', access })
  await DomainEventService.emit({ organizationId, aggregateType: 'whatsapp', aggregateId: String(body.messages?.[0]?.id || Date.now()), eventType: 'activity.whatsapp', leadId: input.leadId, actorId: input.actorId, payload: { summary: `WhatsApp template ${input.templateName} sent`, templateName: input.templateName } })
  return { accepted: true, providerMessageId: body.messages?.[0]?.id || '' }
}
export const WhatsAppService = { get, save, verify, disable, deepLink, sendTemplate }
