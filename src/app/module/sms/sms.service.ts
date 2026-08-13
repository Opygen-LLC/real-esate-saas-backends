import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadService } from '../lead/lead.service'
import { SmsMessage, SmsOptOut, SmsTemplate } from './sms.model'

const provider = config.sms.provider_name || 'generic-bd-http'
const interpolate = (body: string, variables: Record<string, string>) => body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => variables[key] ?? '')

const send = async (organizationId: string, input: { phone: string; message?: string; templateKey?: string; variables?: Record<string, string>; leadId?: string; sentBy?: string }) => {
  const phone = normalizeBangladeshPhone(input.phone)
  if (await SmsOptOut.exists({ organizationId, phone })) throw new ApiError(409, 'Recipient has opted out of SMS')
  let message = input.message?.trim() || ''
  if (input.templateKey) {
    const template = await SmsTemplate.findOne({ organizationId, key: input.templateKey, isActive: true }).lean()
    if (!template) throw new ApiError(404, 'SMS template not found')
    message = interpolate(template.body, input.variables || {})
  }
  if (!message || message.length > 480) throw new ApiError(400, 'SMS message must contain 1-480 characters')
  if (!config.sms.api_url || !config.sms.api_token || !config.sms.sender_id) throw new ApiError(503, 'SMS provider is not configured')

  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.sms.timeout_ms)
  try {
    const response = await fetch(config.sms.api_url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.api_token}` }, body: JSON.stringify({ to: phone, senderId: config.sms.sender_id, message, callbackUrl: config.sms.delivery_callback_url || undefined }) })
    const body: any = await response.json().catch(() => ({}))
    if (!response.ok) throw new ApiError(502, 'SMS provider rejected the message')
    const record: any = await SmsMessage.create({ organizationId, provider, providerMessageId: String(body.messageId || body.id || ''), phone, templateKey: input.templateKey || '', message, status: 'accepted', cost: Number(body.cost || 0), leadId: input.leadId, sentBy: input.sentBy })
    if (input.leadId && input.sentBy) await LeadService.recordFirstResponse(organizationId, input.leadId, input.sentBy)
    await DomainEventService.emit({ organizationId, aggregateType: 'sms', aggregateId: record._id.toString(), eventType: 'sms.sent', leadId: input.leadId, actorId: input.sentBy, payload: { summary: `SMS accepted for ${phone.slice(-4).padStart(phone.length, '•')}`, templateKey: input.templateKey || '' } })
    return record
  } finally { clearTimeout(timer) }
}

const upsertTemplate = async (organizationId: string, payload: any) => SmsTemplate.findOneAndUpdate({ organizationId, key: payload.key }, { ...payload, organizationId }, { upsert: true, new: true, runValidators: true })
const listTemplates = async (organizationId: string) => SmsTemplate.find({ organizationId }).sort({ name: 1 }).lean()
const optOut = async (organizationId: string, phoneRaw: string, reason?: string) => SmsOptOut.findOneAndUpdate({ organizationId, phone: normalizeBangladeshPhone(phoneRaw) }, { organizationId, phone: normalizeBangladeshPhone(phoneRaw), reason: reason || 'user_request', optedOutAt: new Date() }, { upsert: true, new: true })
const optIn = async (organizationId: string, phoneRaw: string) => SmsOptOut.deleteOne({ organizationId, phone: normalizeBangladeshPhone(phoneRaw) })

const receipt = async (payload: any) => {
  const providerMessageId = String(payload.messageId || payload.id || '')
  if (!providerMessageId) throw new ApiError(400, 'messageId is required')
  const normalized = String(payload.status || '').toLowerCase()
  const status = ['delivered'].includes(normalized) ? 'delivered' : ['failed', 'undelivered', 'rejected'].includes(normalized) ? 'failed' : 'sent'
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
    try { const response = await fetch(config.sms.balance_url, { headers: { authorization: `Bearer ${config.sms.api_token}` } }); const body: any = await response.json(); if (response.ok && Number.isFinite(Number(body.balance))) providerBalance = Number(body.balance) } catch { providerBalance = null }
  }
  return { byStatus: rows, totalMessages: rows.reduce((s: number, r: any) => s + r.count, 0), totalCost: rows.reduce((s: number, r: any) => s + r.cost, 0), currency: 'BDT', providerBalance }
}

export const SmsService = { send, upsertTemplate, listTemplates, optOut, optIn, receipt, usage }
