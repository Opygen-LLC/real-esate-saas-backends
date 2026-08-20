import type mongoose from 'mongoose'

export type LeadAllowanceSource = 'manual' | 'website' | 'contact' | 'bulk_import' | 'api' | 'automation' | 'integration'
export type LeadAllowanceMode = 'benefit_period' | 'pipeline_fallback'
export type LeadAllowanceReservationStatus = 'reserved' | 'finalized' | 'released'

export interface ILeadAllowanceReservation {
  reservationId: string
  organizationId: string
  mode: LeadAllowanceMode
  benefitPeriodId?: mongoose.Types.ObjectId | string
  source: LeadAllowanceSource
  requestedUnits: number
  grantedUnits: number
  consumedUnits: number
  releasedUnits: number
  status: LeadAllowanceReservationStatus
  expiresAt: Date
  createdAt?: Date
  updatedAt?: Date
}
