import mongoose, { Schema, Model } from 'mongoose'
import { IBilling } from './billing.interface'

const billingSchema = new Schema<IBilling>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    invoiceId: {
      type: String,
      required: true,
      unique: true,
    },
    serviceType: {
      type: String,
      enum: ['subscription', 'messaging', 'design', 'domain', 'service'],
      default: 'subscription',
      required: true,
    },
    serviceName: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      default: 'starter',
    },
    planVersion: { type: Number, default: 1, min: 1 },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'one-time'],
      default: 'monthly',
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    paymentId: {
      type: String,
      default: '',
      index: true,
    },
    transactionId: {
      type: String,
      default: '',
    },
    paymentMethod: {
      type: String,
      default: 'Manual',
    },
    status: {
      type: String,
      enum: ['paid', 'pending', 'failed', 'refunded'],
      default: 'paid',
      required: true,
    },
    taxSnapshot: {
      invoiceEnabled: { type: Boolean, default: false },
      registrationStatus: { type: String, enum: ['not_registered', 'registered'], default: 'not_registered' },
      operatorLegalName: { type: String, default: '' }, binEncrypted: { type: String, default: '', select: false },
      vatRate: { type: Number, default: 0 }, pricesIncludeVat: { type: Boolean, default: true },
      netAmount: { type: Number, default: 0 }, vatAmount: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

export const Billing: Model<IBilling> = mongoose.model<IBilling>('Billing', billingSchema)
