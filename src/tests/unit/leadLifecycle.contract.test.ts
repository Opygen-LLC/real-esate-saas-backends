import { describe, expect, it } from 'vitest'
import { LeadLifecycleService } from '../../app/module/lead/leadLifecycle.service'
import { LeadValidation } from '../../app/module/lead/lead.validation'
import { LEAD_CONVERSION_STATUS, LEAD_STATUS } from '../../app/module/lead/leadStatus.contract'
import { DomainEventService } from '../../app/module/domainEvent/domainEvent.service'

describe('CRM Phase 4 lead lifecycle contract', () => {
  it('centralizes every lifecycle operation behind one service', () => {
    for (const method of ['changeStatus', 'assignLead', 'scheduleFollowUp', 'recordContact', 'convertToContact', 'reengage'] as const) {
      expect(typeof LeadLifecycleService[method], method).toBe('function')
    }
    expect(LEAD_CONVERSION_STATUS).toBe(LEAD_STATUS.WON)
  })

  it('accepts an auditable status reason and keeps Won on the dedicated status route', () => {
    const valid = LeadValidation.updateLeadStatusZodSchema.safeParse({ body: {
      leadStatus: LEAD_STATUS.INTERESTED,
      reason: 'Client confirmed budget and preferred area',
    } })
    expect(valid.success).toBe(true)

    const won = LeadValidation.updateLeadStatusZodSchema.safeParse({ body: {
      leadStatus: LEAD_STATUS.WON,
      reason: 'Sale completed',
    } })
    expect(won.success).toBe(true)
  })

  it('forces follow-up scheduling through the lifecycle endpoint instead of generic Lead PATCH', () => {
    const lifecycle = LeadValidation.scheduleLeadFollowUpZodSchema.safeParse({ body: {
      followUpDate: '2026-08-20T04:00:00.000Z',
      title: 'Call after valuation',
      priority: 'high',
      reason: 'Client asked for a morning call',
    } })
    expect(lifecycle.success).toBe(true)

    for (const field of ['followUpDate', 'nextFollowUp']) {
      const generic = LeadValidation.updateLeadZodSchema.safeParse({ body: { [field]: '2026-08-20T04:00:00.000Z' } })
      expect(generic.success, field).toBe(false)
    }
  })

  it('supports explicit re-engagement reasons and deferred post-commit event publishing', () => {
    const parsed = LeadValidation.reengageLeadZodSchema.safeParse({ body: { reason: 'Client replied after being dormant' } })
    expect(parsed.success).toBe(true)
    expect(typeof DomainEventService.publish).toBe('function')
  })
})
