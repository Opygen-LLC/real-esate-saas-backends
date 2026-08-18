import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Resilience } from '../../../shared/resilience'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { LeadLifecycleService } from '../lead/leadLifecycle.service'
import type { CrmAccessContext } from '../crm/crmAccess'
import { SmsMessage, SmsOptOut, SmsTemplate } from './sms.model'

const provider = config.sms.provider_name || 'generic-bd-http'
export const interpolateSmsTemplate = (body: string, variables: Record<string, string>) => body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => variables[key] ?? '')

type SmsInput = { phone: string; message?: string; templateKey?: string; variables?: Record<string, string>; leadId?: string; sentBy?: string }
type PreparedSms = { phone: string; message: string; templateKey: string; leadId?: string; sentBy?: string }

const prepare = async (organizationId: string, input: SmsInput, access?: CrmAccessContext): Promise<PreparedSms> => {
  if (input.leadId && access) {
    // A team-read grant is deliberately read-only. SMS is an outbound mutation,
    // so linked Lead ownership is checked using the caller's default mutation scope.
    await LeadService.getLeadById(organizationId, input.leadId, access)
  }
  const phone = normalizeBangladeshPhone(input.phone)
  if (await SmsOptOut.exists({ organizationId, phone })) throw new ApiError(409, 'Recipient has opted out of SMS')
  let message = input.message?.trim() || ''
  if (input.templateKey) {
    const template = await SmsTemplate.findOne({ organizationId, key: input.templateKey, isActive: true }).lean()
    if (!template) throw new ApiError(404, 'SMS template not found')
    message = interpolateSmsTemplate(template.body, input.variables || {})
  }
  if (!message || message.length > 480) throw new ApiError(400, 'SMS message must contain 1-480 characters')
  if (!config.sms.api_url || !config.sms.api_token || !config.sms.sender_id) throw new ApiError(503, 'SMS provider is not configured')
  return { phone, message, templateKey: input.templateKey || '', leadId: input.leadId, sentBy: input.sentBy }
}

export const buildSmsProviderPayload = (input: { phone: string; message: string }, callbackUrl = config.sms.delivery_callback_url) => ({
  to: input.phone,
  senderId: config.sms.sender_id,
  message: input.message,
  callbackUrl: callbackUrl || undefined,
})

export const parseSmsProviderAcceptance = (ok: boolean, body: Record<string, unknown> = {}) => {
  if (!ok) throw new ApiError(502, 'SMS provider rejected the message')
  return {
    providerMessageId: String(body.messageId || body.id || body.smsId || ''),
    cost: Number.isFinite(Number(body.cost)) ? Number(body.cost) : 0,
  }
}

export const mapSmsDeliveryStatus = (value: unknown): 'sent' | 'delivered' | 'failed' => {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'delivered') return 'delivered'
  return ['failed', 'undelivered', 'rejected'].includes(normalized) ? 'failed' : 'sent'
}

const deliverPrepared = async (organizationId: string, input: PreparedSms) => {
  if (await SmsOptOut.exists({ organizationId, phone: input.phone })) throw new ApiError(409, 'Recipient opted out before queued SMS delivery')
  const response = await Resilience.fetch('sms-provider', config.sms.api_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.api_token}` },
    body: JSON.stringify(buildSmsProviderPayload(input)),
  }, { timeoutMs: config.sms.timeout_ms })
  const body: any = await response.json().catch(() => ({}))
  const acceptance = parseSmsProviderAcceptance(response.ok, body)
  const record: any = await SmsMessage.create({ organizationId, provider, providerMessageId: acceptance.providerMessageId, phone: input.phone, templateKey: input.templateKey, message: input.message, status: 'accepted', cost: acceptance.cost, leadId: input.leadId, sentBy: input.sentBy })
  if (input.leadId && input.sentBy) await LeadLifecycleService.recordContact(organizationId, input.leadId, { actorId: input.sentBy, channel: 'sms' })
  await DomainEventService.emit({ organizationId, aggregateType: 'sms', aggregateId: record._id.toString(), eventType: 'sms.sent', leadId: input.leadId, actorId: input.sentBy, payload: { summary: `SMS accepted for ••••${input.phone.slice(-4)}`, templateKey: input.templateKey } })
  return record
}

const send = async (organizationId: string, input: SmsInput, access?: CrmAccessContext) => deliverPrepared(organizationId, await prepare(organizationId, input, access))
const upsertTemplate = async (organizationId: string, payload: any) => SmsTemplate.findOneAndUpdate({ organizationId, key: payload.key }, { ...payload, organizationId }, { upsert: true, new: true, runValidators: true })
const listTemplates = async (organizationId: string) => SmsTemplate.find({ organizationId }).sort({ name: 1 }).lean()
const optOut = async (organizationId: string, phoneRaw: string, reason?: string) => SmsOptOut.findOneAndUpdate({ organizationId, phone: normalizeBangladeshPhone(phoneRaw) }, { organizationId, phone: normalizeBangladeshPhone(phoneRaw), reason: reason || 'user_request', optedOutAt: new Date() }, { upsert: true, new: true })
const optIn = async (organizationId: string, phoneRaw: string) => SmsOptOut.deleteOne({ organizationId, phone: normalizeBangladeshPhone(phoneRaw) })

const receipt = async (payload: any) => {
  const providerMessageId = String(payload.messageId || payload.id || '')
  if (!providerMessageId) throw new ApiError(400, 'messageId is required')
  const status = mapSmsDeliveryStatus(payload.status)
  const record: any = await SmsMessage.findOneAndUpdate({ providerMessageId }, { $set: { status, ...(status === 'delivered' ? { deliveredAt: new Date() } : {}), ...(status === 'failed' ? { failedAt: new Date(), failureCode: String(payload.code || '') } : {}) } }, { new: true })
  if (record && status === 'delivered') await DomainEventService.emit({ organizationId: record.organizationId, aggregateType: 'sms', aggregateId: record._id.toString(), eventType: 'sms.delivered', leadId: record.leadId?.toString(), payload: { summary: 'SMS delivery confirmed by provider' } })
  return record
}

const usage = async (organizationId: string, start?: string, end?: string) => {
  const match: any = { organizationId }
  if (start || end) match.createdAt = { ...(start ? { $gte: new Date(start) } : {}), ...(end ? { $lte: new Date(end) } : {}) }
  const rows = await SmsMessage.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, cost: { $sum: '$cost' } } }])
  let providerBalance: number | null = null
  if (config.sms.balance_url) {
    try {
      const response = await Resilience.fetch('sms-provider', config.sms.balance_url, { headers: { authorization: `Bearer ${config.sms.api_token}` } }, { timeoutMs: config.sms.timeout_ms })
      const body: any = await response.json()
      if (response.ok && Number.isFinite(Number(body.balance))) providerBalance = Number(body.balance)
    } catch { providerBalance = null }
  }
  return { byStatus: rows, totalMessages: rows.reduce((sum: number, row: any) => sum + row.count, 0), totalCost: rows.reduce((sum: number, row: any) => sum + row.cost, 0), currency: 'BDT', providerBalance }
}

export const SmsService = { prepare, deliverPrepared, send, upsertTemplate, listTemplates, optOut, optIn, receipt, usage }
