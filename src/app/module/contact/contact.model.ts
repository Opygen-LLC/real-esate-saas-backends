import { Schema, model } from 'mongoose'
import { IContact, ContactModel } from './contact.interface'

const contactSchema = new Schema<IContact, ContactModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['Buyer', 'Seller', 'Tenant', 'Landlord', 'Investor', 'Partner', 'Other'],
      default: 'Buyer',
    },
    address: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      default: '',
    },
    state: {
      type: String,
      default: '',
    },
    country: {
      type: String,
      default: 'Bangladesh',
    },
    company: {
      type: String,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

contactSchema.index({ organizationId: 1, name: 1 })
contactSchema.index({ organizationId: 1, phone: 1 })

export const Contact = model<IContact, ContactModel>('Contact', contactSchema)
