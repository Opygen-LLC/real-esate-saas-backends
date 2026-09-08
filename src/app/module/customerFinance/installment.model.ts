import { Schema, model } from 'mongoose'
import { IInstallment, INSTALLMENT_KINDS, INSTALLMENT_STATUSES, InstallmentModel } from './customerFinance.interface'

const installmentSchema = new Schema<IInstallment, InstallmentModel>(
  {
    organizationId: { type: String, required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'SaleBooking', required: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    kind: { type: String, enum: INSTALLMENT_KINDS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    dueDate: { type: Date, required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    status: { type: String, enum: INSTALLMENT_STATUSES, default: 'Upcoming', required: true, index: true },
    paidAmountMinor: { type: Number, default: 0, required: true, min: 0 },
  },
  { timestamps: true },
)

installmentSchema.index({ organizationId: 1, bookingId: 1, sequence: 1 }, { unique: true, name: 'installment_tenant_booking_sequence_unique' })
installmentSchema.index({ organizationId: 1, bookingId: 1, dueDate: 1, sequence: 1 }, { name: 'installment_tenant_booking_due' })
installmentSchema.index({ organizationId: 1, status: 1, dueDate: 1 }, { name: 'installment_tenant_status_due' })

export const Installment = model<IInstallment, InstallmentModel>('Installment', installmentSchema)
