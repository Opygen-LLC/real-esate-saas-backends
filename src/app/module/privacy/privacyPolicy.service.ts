import ApiError from '../../../errors/ApiError'
import { PlatformSettings } from '../platformSettings/platformSettings.model'

export type PublicPrivacyPolicyState = {
  ready: boolean
  policyUrl: string
  policyVersion: string
  legalReviewStatus: 'required' | 'approved'
}

const getPublicPolicyState = async (): Promise<PublicPrivacyPolicyState> => {
  const settings: any = await PlatformSettings.findOne({ key: 'platform' }).select('privacy').lean()

  const policyVersion = String(settings?.privacy?.policyVersion || '').trim()
  const policyUrl = String(settings?.privacy?.policyUrl || '').trim()
  const legalReviewStatus = settings?.privacy?.legalReviewStatus === 'approved' ? 'approved' : 'required'

  return {
    ready: legalReviewStatus === 'approved' && Boolean(policyVersion) && Boolean(policyUrl),
    policyUrl,
    policyVersion,
    legalReviewStatus,
  }
}

const assertCurrentPublicPolicy = async (submittedVersion: string): Promise<PublicPrivacyPolicyState> => {
  const state = await getPublicPolicyState()
  if (!state.ready) {
    throw new ApiError(
      503,
      'Public forms are temporarily unavailable while the privacy policy is being configured',
      '',
      'PUBLIC_FORMS_UNAVAILABLE',
      { privacyReady: false },
      { policyVersion: ['Privacy policy is not ready yet'] },
    )
  }
  if (submittedVersion !== state.policyVersion) {
    throw new ApiError(
      409,
      'The privacy policy changed. Please review it and submit the form again.',
      '',
      'PRIVACY_POLICY_OUTDATED',
      { currentPolicyVersion: state.policyVersion },
      { policyVersion: ['Privacy policy changed. Please review the latest version and submit again.'] },
    )
  }
  return state
}

export const PrivacyPolicyService = { getPublicPolicyState, assertCurrentPublicPolicy }
