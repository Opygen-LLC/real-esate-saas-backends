import { Model, Schema, model } from 'mongoose'
import { IBkashPayment } from './bkashPayment.interface'
import { PAID_PLAN_ID_PATTERN } from '../subscriptionPlan/planIdentity'

const bkashPaymentSchema = new Schema<IBkashPayment>(
  {
    organizationId: { type: String, required: true, index: true },
    initiatedBy: { type: String, default: '' },
    planId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 50,
      match: PAID_PLAN_ID_PATTERN,
    },
    planName: { type: String, required: true },
    planVersion: { type: Number, required: true, default: 1, min: 1 },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true, min: 1 },
    quoteSnapshot: { type: Schema.Types.Mixed, default: null },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    maxProperties: { type: Number, required: true },
    maxAgents: { type: Number, required: true },
    maxLeads: { type: Number, required: true, default: 500 },
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
    reconciliationNotes: { type: [{ authorId: String, note: { type: String, maxlength: 1000 }, createdAt: { type: Date, default: Date.now } }], default: [] },
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
