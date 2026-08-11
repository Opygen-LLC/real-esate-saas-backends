import mongoose, { Schema, Model } from 'mongoose'

export interface IVisitorLog {
  organizationId: string
  ip?: string
  city?: string
  country?: string
  device?: string
  browser?: string
  os?: string
  urlPath?: string
  referrer?: string
  createdAt?: Date
}

const visitorLogSchema = new Schema<IVisitorLog>(
  {
    organizationId: { type: String, required: true, index: true },
    ip: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    device: { type: String, default: 'Desktop' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    urlPath: { type: String, default: '/' },
    referrer: { type: String, default: '' },
  },
  { timestamps: true }
)

export const VisitorLog: Model<IVisitorLog> = mongoose.model<IVisitorLog>(
  'VisitorLog',
  visitorLogSchema
)
