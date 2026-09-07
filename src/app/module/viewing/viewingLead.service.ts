import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { CrmService } from '../crm/crm.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Lead } from '../lead/lead.model'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { LEAD_STATUS } from '../lead/leadStatus.contract'
import { TransactionalOutbox } from '../domainEvent/transactionalOutbox.service'
import type { PublicViewingRequestInput } from './viewing.validation'

/** Public booking capture must not call the separately committing generic Lead API. */
export const captureViewingLead = async (payload: PublicViewingRequestInput, agentId: string, session: ClientSession): Promise<any> => {
  const organizationId = payload.organizationId
  const email = (payload.clientEmail || '').trim().toLowerCase()
  const matches: any[] = await Lead.find({ organizationId, $or: [
    { normalizedPhone: payload.clientPhone }, ...(email ? [{ normalizedEmail: email }] : []),
  ] }).sort({ createdAt: 1 }).limit(2).session(session)
  if (matches.length > 1) throw new ApiError(409, 'Please contact the agency to confirm your contact details', '', 'VIEWING_CONTACT_REVIEW_REQUIRED')
  let lead: any = matches[0]
  if (lead) {
    await LeadEntitlementService.assertLeadAccessible(organizationId, String(lead._id), session)
    if (lead.isConverted) throw new ApiError(409, 'Please contact the agency to arrange a viewing for your existing relationship', '', 'VIEWING_CONTACT_REVIEW_REQUIRED')
    // Never overwrite a CRM identity or delete another lead based on an
    // unauthenticated email/phone match. Keep its assignment and historic data.
    if (String(lead.normalizedPhone) !== payload.clientPhone) throw new ApiError(409, 'Please contact the agency to confirm your contact details', '', 'VIEWING_CONTACT_REVIEW_REQUIRED')
    const properties = new Set((lead.propertyInterest || []).map(String))
    properties.add(payload.propertyId)
    lead.propertyInterest = [...properties]
    if (payload.attribution) lead.attribution = { ...(lead.attribution?.toObject?.() || lead.attribution || {}), ...payload.attribution, firstTouchAt: lead.attribution?.firstTouchAt || new Date(), lastTouchAt: new Date() }
    await lead.save({ session })
  } else {
    const allowance = await EntitlementService.reserveLeadAllowance(organizationId, 1, { source: 'website', session })
    if (!allowance.reservationId) throw new ApiError(409, 'No lead allowance is available', '', 'LEAD_ALLOWANCE_EXHAUSTED')
    const crm: any = await CrmService.getConfig(organizationId, session)
    const now = new Date()
    lead = (await Lead.create([{
      organizationId, name: payload.clientName, phone: payload.clientPhone, normalizedPhone: payload.clientPhone,
      email, normalizedEmail: email, assignedAgent: agentId, source: 'Website', leadStatus: LEAD_STATUS.NEW,
      propertyInterest: [payload.propertyId], isConverted: false, leadScore: email ? 40 : 30,
      scoreReasons: ['Base inquiry', 'Property selected', ...(email ? ['Email provided'] : [])],
      responseDueAt: new Date(now.getTime() + Number(crm.responseSlaMinutes || 30) * 60000),
      leadAllowanceReservationId: allowance.reservationId, benefitPeriodId: allowance.benefitPeriodId || undefined,
      leadAllowanceConsumedAt: now,
      attribution: payload.attribution ? { ...payload.attribution, firstTouchAt: now, lastTouchAt: now } : undefined,
    }], { session }))[0]
    await EntitlementService.consumeLeadAllowanceReservation(organizationId, allowance.reservationId, 1, session)
    await CrmService.recordAssignment({ organizationId, leadId: String(lead._id), assignedAgentId: agentId, strategy: 'property_owner', reason: 'Public viewing request' }, session)
    await TransactionalOutbox.emit({ organizationId, aggregateType: 'lead', aggregateId: String(lead._id), leadId: String(lead._id), eventType: 'lead.created', payload: { summary: 'New lead captured from a viewing request' } }, session)
    await TransactionalOutbox.emit({ organizationId, aggregateType: 'lead', aggregateId: String(lead._id), leadId: String(lead._id), eventType: 'lead.assigned', payload: { summary: 'Lead assigned during viewing capture', assignedAgentId: agentId } }, session)
  }
  if (payload.notes) await TransactionalOutbox.emit({ organizationId, aggregateType: 'lead', aggregateId: String(lead._id), leadId: String(lead._id), eventType: 'activity.note', payload: { summary: payload.notes, source: 'public_viewing' } }, session)
  return lead
}
