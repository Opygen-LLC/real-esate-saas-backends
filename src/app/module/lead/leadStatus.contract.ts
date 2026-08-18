export const LEAD_STATUS_VALUES = [
  'New',
  'Contacted',
  'FollowUpScheduled',
  'NoResponse',
  'Interested',
  'ViewingScheduled',
  'ViewingCompleted',
  'Negotiation',
  'OfferMade',
  'Won',
  'Lost',
  'OnHold',
  'NotQualified',
  'ReEngaged',
] as const

export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number]

export const LEAD_STATUS = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  FOLLOW_UP_SCHEDULED: 'FollowUpScheduled',
  NO_RESPONSE: 'NoResponse',
  INTERESTED: 'Interested',
  VIEWING_SCHEDULED: 'ViewingScheduled',
  VIEWING_COMPLETED: 'ViewingCompleted',
  NEGOTIATION: 'Negotiation',
  OFFER_MADE: 'OfferMade',
  WON: 'Won',
  LOST: 'Lost',
  ON_HOLD: 'OnHold',
  NOT_QUALIFIED: 'NotQualified',
  RE_ENGAGED: 'ReEngaged',
} as const satisfies Record<string, LeadStatus>

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  New: 'New',
  Contacted: 'Contacted',
  FollowUpScheduled: 'Follow-up Scheduled',
  NoResponse: 'No Response',
  Interested: 'Interested',
  ViewingScheduled: 'Viewing Scheduled',
  ViewingCompleted: 'Viewing Done',
  Negotiation: 'Negotiation',
  OfferMade: 'Offer Made',
  Won: 'Won / Converted',
  Lost: 'Lost / Declined',
  OnHold: 'On Hold',
  NotQualified: 'Not Qualified',
  ReEngaged: 'Re-engaged',
}

export const LEGACY_LEAD_STATUS_ALIASES = {
  Qualified: LEAD_STATUS.INTERESTED,
} as const

export type LegacyLeadStatus = keyof typeof LEGACY_LEAD_STATUS_ALIASES

const statusSet = new Set<string>(LEAD_STATUS_VALUES)

export const isLeadStatus = (value: unknown): value is LeadStatus =>
  typeof value === 'string' && statusSet.has(value)

export const normalizeLeadStatus = (value: unknown): LeadStatus | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (isLeadStatus(trimmed)) return trimmed
  return LEGACY_LEAD_STATUS_ALIASES[trimmed as LegacyLeadStatus]
}

export const LEAD_CONVERSION_STATUS: LeadStatus = LEAD_STATUS.WON
export const isLeadConversionStatus = (value: unknown) => normalizeLeadStatus(value) === LEAD_CONVERSION_STATUS

export const LEAD_CLOSED_STATUSES: LeadStatus[] = [LEAD_STATUS.WON, LEAD_STATUS.LOST]
export const LEAD_TERMINAL_STATUSES: LeadStatus[] = [LEAD_STATUS.WON, LEAD_STATUS.LOST, LEAD_STATUS.NOT_QUALIFIED]

export const DEFAULT_LEAD_PIPELINE_STAGES = LEAD_STATUS_VALUES.map((key, order) => ({
  key,
  label: LEAD_STATUS_LABELS[key],
  order,
  terminal: LEAD_TERMINAL_STATUSES.includes(key),
  won: key === LEAD_CONVERSION_STATUS,
  lost: key === LEAD_STATUS.LOST,
}))

export type LeadPipelineStage = (typeof DEFAULT_LEAD_PIPELINE_STAGES)[number] & { color?: string }

export const leadStatusFilterValues = (value: unknown): string[] => {
  const normalized = normalizeLeadStatus(value)
  if (!normalized) return []
  // Keep reads compatible while the Qualified -> Interested migration is rolling out.
  return normalized === LEAD_STATUS.INTERESTED ? [LEAD_STATUS.INTERESTED, 'Qualified'] : [normalized]
}
