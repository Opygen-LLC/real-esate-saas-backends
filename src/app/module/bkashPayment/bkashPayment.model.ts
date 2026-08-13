import { Model, Schema, model } from 'mongoose'
import { IBkashPayment } from './bkashPayment.interface'

const bkashPaymentSchema = new Schema<IBkashPayment>(
  {
    organizationId: { type: String, required: true, index: true },
    initiatedBy: { type: String, default: '' },
    planId: {
      type: String,
      enum: ['starter', 'professional', 'agency', 'enterprise'],
      required: true,
    },
    planName: { type: String, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    maxProperties: { type: Number, required: true },
    maxAgents: { type: Number, required: true },
    taxSnapshot: {
      invoiceEnabled: { type: Boolean, default: false }, registrationStatus: { type: String, enum: ['not_registered', 'registered'], default: 'not_registered' },
      operatorLegalName: { type: String, default: '' }, binEncrypted: { type: String, default: '', select: false },
      vatRate: { type: Number, default: 0 }, pricesIncludeVat: { type: Boolean, default: true },
      baseAmount: { type: Number, default: 0 }, vatAmount: { type: Number, default: 0 },
    },
    invoiceNumber: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, required: true },
    paymentId: { type: String, sparse: true, unique: true },
    bkashURL: { type: String, default: '' },
    transactionId: { type: String, default: '' },
    payerAccount: { type: String, default: '' },
    gatewayStatusCode: { type: String, default: '' },
    gatewayStatusMessage: { type: String, default: '' },
    status: {
      type: String,
      enum: ['initialized', 'pending', 'executing', 'succeeded', 'failed', 'cancelled'],
      default: 'initialized',
      index: true,
    },
  },
  { timestamps: true }
)

bkashPaymentSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true })

export const BkashPayment: Model<IBkashPayment> = model<IBkashPayment>(
  'BkashPayment',
  bkashPaymentSchema
)
