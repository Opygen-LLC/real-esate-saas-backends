export type PrivacyConsentPurpose = 'service_terms' | 'privacy_policy' | 'marketing'

export interface IPrivacyConsentRecord {
  organizationId: string
  userId: string
  purpose: PrivacyConsentPurpose
  policyVersion: string
  granted: boolean
  capturedAt: Date
  ip?: string
  requestId?: string
}

export interface IPrivacyConsentContext {
  ip?: string
  requestId?: string
}
