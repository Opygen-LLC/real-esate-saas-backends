import { createHash } from 'crypto'
import ApiError from '../../../errors/ApiError'
import type { PublicViewingRequestInput } from './viewing.validation'

export const VIEWING_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export const viewingRequestIdentity = (payload: PublicViewingRequestInput, suppliedKey?: string): { keyDigest: string; payloadHash: string } => {
  if (suppliedKey !== undefined && !/^[A-Za-z0-9._:-]{16,128}$/.test(suppliedKey)) {
    throw new ApiError(400, 'Idempotency-Key must contain 16-128 URL-safe characters', '', 'INVALID_IDEMPOTENCY_KEY')
  }
  // Attribution is deliberately excluded: tracking/referrer changes are not a
  // new booking. Every business and consent field is bound to the request key.
  const canonical = JSON.stringify([
    payload.organizationId, payload.propertyId.toLowerCase(), payload.date, payload.startTime, payload.endTime,
    payload.clientName.trim(), payload.clientPhone, (payload.clientEmail || '').trim().toLowerCase(),
    (payload.notes || '').trim(), payload.privacyConsent, payload.policyVersion,
  ])
  const payloadHash = digest(canonical)
  // Old clients remain retry-safe during rolling deployment without requiring a
  // new body field. Persist only digests, never the request key or contact data.
  return { keyDigest: digest(`${payload.organizationId}:public-viewing:${suppliedKey || `legacy:${payloadHash}`}`), payloadHash }
}
