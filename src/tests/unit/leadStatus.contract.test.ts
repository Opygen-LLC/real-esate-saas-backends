import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEAD_PIPELINE_STAGES,
  LEAD_CLOSED_STATUSES,
  LEAD_CONVERSION_STATUS,
  activePipelineLeadFilter,
  convertedStatusExpression,
  isActivePipelineStatus,
  isClosedStatus,
  isConvertedStatus,
  isLeadConversionStatus,
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_VALUES,
  normalizeLeadStatus,
} from '../../app/module/lead/leadStatus.contract'

describe('CRM lead status contract', () => {
  it('keeps the Phase 0 lifecycle in one canonical order', () => {
    expect(LEAD_STATUS_VALUES).toEqual([
      'New', 'Contacted', 'FollowUpScheduled', 'NoResponse', 'Interested',
      'ViewingScheduled', 'ViewingCompleted', 'Negotiation', 'OfferMade', 'Won',
      'Lost', 'OnHold', 'NotQualified', 'ReEngaged',
    ])
    expect(DEFAULT_LEAD_PIPELINE_STAGES.map((stage) => stage.key)).toEqual(LEAD_STATUS_VALUES)
  })

  it('normalizes the only supported legacy status without changing stable internal keys', () => {
    expect(normalizeLeadStatus('Qualified')).toBe(LEAD_STATUS.INTERESTED)
    expect(normalizeLeadStatus('ViewingScheduled')).toBe(LEAD_STATUS.VIEWING_SCHEDULED)
    expect(normalizeLeadStatus('ViewingCompleted')).toBe(LEAD_STATUS.VIEWING_COMPLETED)
    expect(normalizeLeadStatus('Won')).toBe(LEAD_STATUS.WON)
    expect(normalizeLeadStatus('Lost')).toBe(LEAD_STATUS.LOST)
  })

  it('uses Won as the only conversion trigger', () => {
    expect(LEAD_CONVERSION_STATUS).toBe('Won')
    expect(isLeadConversionStatus('Won')).toBe(true)
    expect(isLeadConversionStatus('Interested')).toBe(false)
  })

  it('owns reusable converted/closed/active-pipeline semantics', () => {
    expect(isConvertedStatus('Won')).toBe(true)
    expect(isConvertedStatus('Lost')).toBe(false)
    expect(isClosedStatus('Won')).toBe(true)
    expect(isClosedStatus('Lost')).toBe(true)
    expect(isClosedStatus('Interested')).toBe(false)
    expect(isActivePipelineStatus('Interested')).toBe(true)
    expect(isActivePipelineStatus('Lost')).toBe(false)
    expect(isActivePipelineStatus('Interested', true)).toBe(false)
    expect(activePipelineLeadFilter()).toEqual({
      isConverted: { $ne: true },
      leadStatus: { $nin: [LEAD_STATUS.WON, LEAD_STATUS.LOST] },
    })
    expect(convertedStatusExpression()).toEqual({ $in: ['$leadStatus', [LEAD_STATUS.WON]] })
  })

  it('owns canonical UI labels and closed-status semantics', () => {
    expect(LEAD_STATUS_LABELS.Won).toBe('Won / Converted')
    expect(LEAD_STATUS_LABELS.Lost).toBe('Lost / Declined')
    expect(LEAD_STATUS_LABELS.ViewingCompleted).toBe('Viewing Done')
    expect(LEAD_CLOSED_STATUSES).toEqual([LEAD_STATUS.WON, LEAD_STATUS.LOST])
  })
})
