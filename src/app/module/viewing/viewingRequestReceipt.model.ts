import { Schema, model } from 'mongoose'

const schema = new Schema({
  organizationId: { type: String, required: true },
  keyDigest: { type: String, required: true },
  payloadHash: { type: String, required: true },
  response: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true })
schema.index({ organizationId: 1, keyDigest: 1 }, { unique: true, name: 'viewing_request_idempotency' })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'viewing_request_receipt_expiry' })
export const ViewingRequestReceipt = model('ViewingRequestReceipt', schema)
