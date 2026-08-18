import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { PlatformSettings } from '../platformSettings/platformSettings.model'

export type PublicPrivacyPolicyState = {
  ready: boolean
  policyUrl: string
  policyVersion: string
  legalReviewStatus: 'required' | 'approved'
}

const getPublicPolicyState = async (): Promise<PublicPrivacyPolicyState> => {
  const settings: any = await PlatformSettings.findOne({ key: 'platform' }).select('privacy').lean()

  const databasePolicyVersion = String(settings?.privacy?.policyVersion || '').trim()
  const databasePolicyUrl = String(settings?.privacy?.policyUrl || '').trim()
  const databaseReviewStatus = settings?.privacy?.legalReviewStatus === 'approved' ? 'approved' : 'required'
  const databaseConfigured = Boolean(databasePolicyVersion || databasePolicyUrl || databaseReviewStatus === 'approved')

  const configuredVersion = databaseConfigured ? databasePolicyVersion : config.privacy.policy_version
  const configuredUrl = databaseConfigured ? databasePolicyUrl : config.privacy.policy_url
  const configuredReviewStatus = databaseConfigured ? databaseReviewStatus : config.privacy.legal_review_status
  // Keep public lead/viewing forms usable out of the box while still presenting a versioned
  // privacy notice. A reviewed policy configured by the platform always takes precedence.
  const usePlatformDefault = !databaseConfigured && !configuredVersion && !configuredUrl
  const policyVersion = usePlatformDefault ? 'platform-default-2026-08' : configuredVersion
  const policyUrl = usePlatformDefault ? `${config.public_site_origin}/privacy` : configuredUrl
  const legalReviewStatus = usePlatformDefault ? 'approved' as const : configuredReviewStatus

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
