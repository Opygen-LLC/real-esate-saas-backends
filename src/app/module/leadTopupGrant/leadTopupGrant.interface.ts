import type { Types } from 'mongoose'

export interface ILeadTopupGrant {
  organizationId: string
  benefitPeriodId: Types.ObjectId
  approvedRequestId: Types.ObjectId
  requestedLeads: number
  grantedLeads: number
  effectiveAt: Date
  expiresAt: Date
  approvedBy: string
  revokedAt?: Date | null
  revokedBy?: string | null
  revokeReason?: string | null
  createdAt?: Date
  updatedAt?: Date
}
