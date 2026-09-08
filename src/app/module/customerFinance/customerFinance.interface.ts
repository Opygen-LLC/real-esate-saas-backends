import mongoose, { Model } from 'mongoose'
import type { InstallmentFrequency, PropertyPaymentType } from '../../../contracts/websiteCatalog/property'

export const SALE_BOOKING_STATUSES = ['Reserved', 'Active', 'Completed', 'Cancelled'] as const
export type SaleBookingStatus = (typeof SALE_BOOKING_STATUSES)[number]

export const INSTALLMENT_STATUSES = ['Upcoming', 'Partial', 'Paid', 'Overdue', 'Waived', 'Cancelled'] as const
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number]

export const INSTALLMENT_KINDS = ['Booking', 'DownPayment', 'Installment', 'Handover', 'Registration', 'Balance'] as const
export type InstallmentKind = (typeof INSTALLMENT_KINDS)[number]

export interface IPaymentPlanSnapshot {
  paymentType: PropertyPaymentType
  advertisedPriceMinor: number
  bookingAmountMinor: number
  downPaymentAmountMinor: number
  downPaymentPercent?: number
  installmentCount: number
  installmentFrequency: InstallmentFrequency
  installmentAmountMinor: number
  handoverPaymentMinor: number
  registrationPaymentMinor: number
  propertyHandoverDate?: Date
  capturedAt: Date
}

export interface ISaleBooking {
  organizationId: string
  bookingNumber: string
  contactId: mongoose.Types.ObjectId | string
  propertyId: mongoose.Types.ObjectId | string
  originatingLeadId?: mongoose.Types.ObjectId | string
  financeInvoiceId?: mongoose.Types.ObjectId | string
  /** Internal uniqueness key while the property has an open booking. */
  activePropertyKey?: string
  agreedPriceMinor: number
  currency: 'BDT'
  bookingDate: Date
  status: SaleBookingStatus
  paymentPlanSnapshot: IPaymentPlanSnapshot
  createdBy: mongoose.Types.ObjectId | string
  updatedBy?: mongoose.Types.ObjectId | string
  createdAt?: Date
  updatedAt?: Date
}

export interface IInstallment {
  organizationId: string
  bookingId: mongoose.Types.ObjectId | string
  sequence: number
  kind: InstallmentKind
  title: string
  dueDate: Date
  amountMinor: number
  status: InstallmentStatus
  paidAmountMinor: number
  createdAt?: Date
  updatedAt?: Date
}

export type SaleBookingModel = Model<ISaleBooking>
export type InstallmentModel = Model<IInstallment>
