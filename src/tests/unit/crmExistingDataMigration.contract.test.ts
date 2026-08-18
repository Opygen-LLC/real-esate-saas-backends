import { describe, expect, it } from 'vitest'
import {
  CONTACT_RELATIONSHIP_STATE,
  CONTACT_RELATIONSHIP_STATE_VALUES,
  visibleContactRelationshipFilter,
} from '../../app/module/contact/contactRelationship.contract'
import { LEAD_CONVERSION_STATUS, LEAD_STATUS } from '../../app/module/lead/leadStatus.contract'

describe('CRM Phase 2 existing-data contract', () => {
  it('keeps Won as the only conversion status', () => {
    expect(LEAD_CONVERSION_STATUS).toBe(LEAD_STATUS.WON)
  })

  it('distinguishes active Contacts from legacy pre-conversion Contacts', () => {
    expect(CONTACT_RELATIONSHIP_STATE_VALUES).toEqual([
      CONTACT_RELATIONSHIP_STATE.ACTIVE,
      CONTACT_RELATIONSHIP_STATE.LEGACY_PRECONVERSION,
    ])
  })

  it('hides legacy pre-conversion Contacts from normal Contact APIs', () => {
    expect(visibleContactRelationshipFilter).toEqual({
      relationshipState: { $ne: CONTACT_RELATIONSHIP_STATE.LEGACY_PRECONVERSION },
    })
  })
})
