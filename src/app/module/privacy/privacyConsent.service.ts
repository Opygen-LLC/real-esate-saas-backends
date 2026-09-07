import type { ClientSession } from 'mongoose'
import { createHash } from 'crypto'
import { IPrivacyConsentContext, PrivacyConsentPurpose } from './privacyConsent.interface'
import { PrivacyConsentRecord } from './privacyConsent.model'

const publicSubjectId = (normalizedIdentifier: string): string =>
  `public:${createHash('sha256').update(normalizedIdentifier).digest('hex')}`

const record = (
  organizationId: string,
  userId: string,
  payload: { purpose: PrivacyConsentPurpose; policyVersion: string; granted: boolean },
  context: IPrivacyConsentContext = {},
  session?: ClientSession,
) => {
  const payloadToSave = {
    organizationId,
    userId,
    purpose: payload.purpose,
    policyVersion: payload.policyVersion,
    granted: payload.granted,
    capturedAt: new Date(),
    ip: context.ip || '',
    requestId: context.requestId || '',
  }
  return session ? PrivacyConsentRecord.create([payloadToSave], { session }).then((rows) => rows[0]) : PrivacyConsentRecord.create(payloadToSave)
}

const recordPublicPrivacyPolicy = (
  organizationId: string,
  normalizedIdentifier: string,
  policyVersion: string,
  context: IPrivacyConsentContext = {},
  session?: ClientSession,
) =>
  record(
    organizationId,
    publicSubjectId(normalizedIdentifier),
    { purpose: 'privacy_policy', policyVersion, granted: true },
    context,
    session,
  )

export const PrivacyConsentService = {
  publicSubjectId,
  record,
  recordPublicPrivacyPolicy,
}
