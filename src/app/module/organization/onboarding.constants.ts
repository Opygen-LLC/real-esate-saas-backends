import type { IOnboardingState } from './organization.interface'

export const ONBOARDING_TOTAL_STEPS = 4
export const ONBOARDING_VERSION = 2

export const normalizeOnboardingStep = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(ONBOARDING_TOTAL_STEPS, Math.trunc(parsed)))
}

export const normalizeOnboardingState = (
  state: IOnboardingState | null | undefined,
  fallbackCompletedAt?: Date,
): IOnboardingState => {
  if (!state) {
    return {
      status: 'completed',
      currentStep: ONBOARDING_TOTAL_STEPS,
      version: ONBOARDING_VERSION,
      completedAt: fallbackCompletedAt || new Date(),
    }
  }

  return {
    ...state,
    currentStep: normalizeOnboardingStep(state.currentStep),
    version: Math.max(Number(state.version || 1), ONBOARDING_VERSION),
  }
}
