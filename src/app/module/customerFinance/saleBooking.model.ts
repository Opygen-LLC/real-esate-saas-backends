import { Schema, model } from 'mongoose'
import { INSTALLMENT_FREQUENCIES, PROPERTY_PAYMENT_TYPES } from '../../../contracts/websiteCatalog/property'
import { ISaleBooking, SALE_BOOKING_STATUSES, SaleBookingModel } from './customerFinance.interface'

const paymentPlanSnapshotSchema = new Schema(
  {
    paymentType: { type: String, enum: PROPERTY_PAYMENT_TYPES, required: true },
    advertisedPriceMinor: { type: Number, required: true, min: 0 },
    bookingAmountMinor: { type: Number, required: true, min: 0, default: 0 },
    downPaymentAmountMinor: { type: Number, required: true, min: 0, default: 0 },
    downPaymentPercent: { type: Number, min: 0, max: 100 },
    installmentCount: { type: Number, required: true, min: 0, max: 600 },
    installmentFrequency: { type: String, enum: INSTALLMENT_FREQUENCIES, required: true },
    installmentAmountMinor: { type: Number, required: true, min: 0, default: 0 },
    handoverPaymentMinor: { type: Number, required: true, min: 0, default: 0 },
    registrationPaymentMinor: { type: Number, required: true, min: 0, default: 0 },
    propertyHandoverDate: { type: Date },
    capturedAt: { type: Date, required: true },
  },
  { _id: false },
)

const saleBookingSchema = new Schema<ISaleBooking, SaleBookingModel>(
  {
    organizationId: { type: String, required: true, index: true },
    bookingNumber: { type: String, required: true, trim: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    originatingLeadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    financeInvoiceId: { type: Schema.Types.ObjectId, ref: 'FinanceInvoice', index: true },
    activePropertyKey: { type: String, trim: true },
    agreedPriceMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['BDT'], default: 'BDT', required: true },
    bookingDate: { type: Date, required: true, index: true },
    status: { type: String, enum: SALE_BOOKING_STATUSES, default: 'Reserved', required: true, index: true },
    paymentPlanSnapshot: { type: paymentPlanSnapshotSchema, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

saleBookingSchema.index({ organizationId: 1, bookingNumber: 1 }, { unique: true, name: 'sale_booking_tenant_number_unique' })
saleBookingSchema.index({ organizationId: 1, contactId: 1, createdAt: -1 }, { name: 'sale_booking_tenant_contact_created' })
saleBookingSchema.index({ organizationId: 1, propertyId: 1, createdAt: -1 }, { name: 'sale_booking_tenant_property_created' })
saleBookingSchema.index(
  { activePropertyKey: 1 },
  {
    unique: true,
    name: 'sale_booking_one_open_property_unique',
    partialFilterExpression: { activePropertyKey: { $type: 'string' } },
  },
)

export const SaleBooking = model<ISaleBooking, SaleBookingModel>('SaleBooking', saleBookingSchema)
