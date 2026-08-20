import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadAllowanceReservation } from './leadAllowanceReservation.interface'

const leadAllowanceReservationSchema = new Schema<ILeadAllowanceReservation>(
  {
    reservationId: { type: String, required: true, unique: true, index: true, trim: true },
    organizationId: { type: String, required: true, index: true, trim: true },
    mode: { type: String, enum: ['benefit_period', 'pipeline_fallback'], required: true, index: true },
    benefitPeriodId: { type: Schema.Types.ObjectId, ref: 'SubscriptionBenefitPeriod', index: true },
    source: { type: String, enum: ['manual', 'website', 'contact', 'bulk_import', 'api', 'automation', 'integration'], required: true },
    requestedUnits: { type: Number, required: true, min: 1 },
    grantedUnits: { type: Number, required: true, min: 1 },
    consumedUnits: { type: Number, required: true, min: 0, default: 0 },
    releasedUnits: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ['reserved', 'finalized', 'released'], required: true, default: 'reserved', index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
)

leadAllowanceReservationSchema.index(
  { organizationId: 1, status: 1, mode: 1, expiresAt: 1 },
  { name: 'tenant_outstanding_lead_allowance_reservations' },
)
leadAllowanceReservationSchema.index(
  { status: 1, expiresAt: 1 },
  { name: 'stale_lead_allowance_reservations' },
)

export const LeadAllowanceReservation: Model<ILeadAllowanceReservation> =
  mongoose.models.LeadAllowanceReservation
  || mongoose.model<ILeadAllowanceReservation>('LeadAllowanceReservation', leadAllowanceReservationSchema)
