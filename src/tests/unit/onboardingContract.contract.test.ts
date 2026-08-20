import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_TOTAL_STEPS,
  ONBOARDING_VERSION,
  normalizeOnboardingState,
  normalizeOnboardingStep,
} from '../../app/module/organization/onboarding.constants'

describe('four-step onboarding contract', () => {
  it('clamps legacy step five to the final supported step', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(4)
    expect(normalizeOnboardingStep(5)).toBe(4)
    expect(normalizeOnboardingStep(99)).toBe(4)
    expect(normalizeOnboardingStep(0)).toBe(1)
  })

  it('normalizes legacy in-progress onboarding without changing its status', () => {
    const normalized = normalizeOnboardingState({
      status: 'in_progress',
      currentStep: 5,
      version: 1,
    })

    expect(normalized).toMatchObject({
      status: 'in_progress',
      currentStep: 4,
      version: ONBOARDING_VERSION,
    })
  })
})
