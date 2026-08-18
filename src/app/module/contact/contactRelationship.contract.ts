export const CONTACT_RELATIONSHIP_STATE = {
  ACTIVE: 'active',
  LEGACY_PRECONVERSION: 'legacy_preconversion',
} as const

export type ContactRelationshipState =
  (typeof CONTACT_RELATIONSHIP_STATE)[keyof typeof CONTACT_RELATIONSHIP_STATE]

export const CONTACT_RELATIONSHIP_STATE_VALUES = Object.values(
  CONTACT_RELATIONSHIP_STATE,
) as ContactRelationshipState[]

/**
 * Normal Contacts APIs must never expose records that only exist because the
 * pre-Phase-1 lead capture flow auto-created a Contact before conversion.
 * Missing values are treated as active for backwards compatibility until the
 * Phase 2 migration has classified every historical Contact.
 */
export const visibleContactRelationshipFilter = {
  relationshipState: { $ne: CONTACT_RELATIONSHIP_STATE.LEGACY_PRECONVERSION },
} as const
