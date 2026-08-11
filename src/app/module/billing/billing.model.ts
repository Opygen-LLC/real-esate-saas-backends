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
    paymentId: {
      type: String,
      default: '',
    },
    paymentMethod: {
      type: String,
      default: 'Credit Card',
    },
    status: {
      type: String,
      enum: ['paid', 'pending', 'failed', 'refunded'],
      default: 'paid',
      required: true,
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
